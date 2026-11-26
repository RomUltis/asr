// ---------------------------------------------------------------------------
//  Carte mentale : noeud central, membres en orbite, dossiers deplacables,
//  pan / zoom, temps reel. Un clic sur un dossier ouvre son tableau (board.js).
// ---------------------------------------------------------------------------
import { api } from '../api.js';
import {
  h, mount, icon, svg, toast, menu, modal, avatar, avatarStack, promptDialog, confirmDialog,
  colorPicker, debounce, hasOpenModal, prefersReducedMotion, timeAgo,
} from '../ui.js';
import { on, isOwnEvent } from '../realtime.js';
import { createTopbar } from '../components/topbar.js';
import { createBoard } from './board.js';
import { createWeb } from './web.js';

const ZMIN = 0.25;
const ZMAX = 2.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function mountMap(root, ctx) {
  const { store, navigate } = ctx;
  const mapId = ctx.params.id;
  let state = null;
  let role = 'member';
  let leaving = false;
  let firstLoad = true;
  const view = { x: 0, y: 0, z: 1 };
  const folderEls = new Map(); // id -> { el, edge }
  let gesture = null;
  let pinnedMember = null;

  // ------------------------------- DOM ------------------------------------
  const titleEl = h('span.map-title-text', '…');
  const titleBtn = h('button.map-title', { onclick: renameMap, title: 'Renommer la carte' }, titleEl, icon('edit', 14));
  const backBtn = h('a.icon-btn.back-btn', { href: '/', 'data-link': '', 'aria-label': 'Mes cartes' }, icon('back', 19));
  const membersEl = h('button.top-members', { onclick: openTeam, 'aria-label': 'Équipe' });
  const inviteBtn = h('button.btn.btn-primary.btn-sm.invite-btn', { onclick: openTeam }, icon('userPlus', 16), h('span', 'Inviter'));
  const moreBtn = h('button.icon-btn', { 'aria-label': 'Options de la carte', onclick: () => mapMenu() }, icon('more', 18));

  // Bascule entre la carte des taches et la toile 3D des besoins
  const viewSeg = h(
    'div.view-seg',
    { role: 'tablist', dataset: { v: 'taches' } },
    h('span.view-thumb'),
    h('button.view-btn', { dataset: { v: 'taches' }, onclick: () => navigate(`/carte/${mapId}`) }, icon('folder', 15), h('span', 'Tâches')),
    h('button.view-btn', { dataset: { v: 'besoins' }, onclick: () => navigate(`/carte/${mapId}/besoins`) }, icon('sparkles', 15), h('span', 'Besoins'))
  );

  const topbar = createTopbar({
    ...ctx,
    center: viewSeg,
    left: h('div.map-left', backBtn, h('img.map-logo', { src: '/assets/logo.svg', alt: '', width: 26, height: 26 }), titleBtn, moreBtn),
    extra: [membersEl, inviteBtn],
    onUserChange: () => load(),
  });

  const edgesG = svg('g', { class: 'edges-g' });
  const linksG = svg('g', { class: 'links-g' });
  const edges = svg('svg', { class: 'edges', width: 1, height: 1 }, edgesG, linksG);
  const ring = svg('circle', { cx: 80, cy: 80, r: 74, class: 'core-ring-fg', pathLength: 100 });
  const coreTitle = h('b.core-title');
  const corePct = h('span.core-pct');
  const core = h(
    'div.core',
    { onclick: openTeam, title: 'Voir l’équipe' },
    svg('svg', { class: 'core-ring', viewBox: '0 0 160 160' }, svg('circle', { cx: 80, cy: 80, r: 74, class: 'core-ring-bg' }), ring),
    h('div.core-inner', coreTitle, corePct)
  );
  const orbit = h('div.orbit');
  const nodesLayer = h('div.nodes');
  const ghost = h(
    'button.ghost-folder',
    { onclick: () => createFolder(), style: { left: '330px', top: '0px' } },
    icon('plus', 22),
    h('b', 'Créer un dossier'),
    h('small', 'ex : Recherche, Rapport, Démo…')
  );
  const world = h('div.world', edges, orbit, core, nodesLayer, ghost);
  const stage = h('div.stage', { tabIndex: -1 }, world);

  const zoomLabel = h('button.tool-zoom', { onclick: () => animateView({ ...view, z: 1, ...centerOn(view.z, 1) }), title: 'Zoom 100 %' }, '100%');
  const toolbar = h(
    'div.toolbar',
    h('button.btn.btn-primary.btn-sm', { onclick: () => createFolder() }, icon('plus', 16), h('span', 'Dossier')),
    h('span.tool-sep'),
    h('button.icon-btn', { onclick: () => zoomBy(1 / 1.25), 'aria-label': 'Dézoomer' }, icon('zoomOut', 18)),
    zoomLabel,
    h('button.icon-btn', { onclick: () => zoomBy(1.25), 'aria-label': 'Zoomer' }, icon('zoomIn', 18)),
    h('span.tool-sep'),
    h('button.icon-btn', { onclick: () => fitView(true), 'aria-label': 'Tout afficher', title: 'Tout afficher (F)' }, icon('target', 18))
  );
  const hint = h('div.map-hint', h('span', 'Glisser pour se déplacer'), h('span', 'Molette pour zoomer'), h('span', 'Double-clic pour créer un dossier'));
  const tip = h('div.member-tip');
  const wrap = h('div.map-wrap', stage, toolbar, hint, tip);
  const layout = h('div.layout.map-layout', topbar.el, wrap);
  mount(root, layout);

  // ------------------------------ Board -----------------------------------
  const board = createBoard({
    host: layout,
    mapId,
    store,
    getState: () => state,
    applyState: (s) => setState(s),
    getFolderRect,
    getFolderCard: (fid) => folderEls.get(fid)?.el.querySelector('.fcard'),
    getZoom: () => view.z,
    onDive: dive,
    setFolderHidden: (fid, hidden) => folderEls.get(fid)?.el.classList.toggle('hidden-for-board', hidden),
    onLanded: (fid) => folderEls.get(fid)?.el.querySelector('.fcard')?.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.3,1.6,.5,1)' }),
    requestClose: () => navigate(`/carte/${mapId}`),
  });

  // ------------------------- Toile 3D des besoins ---------------------------
  const web = createWeb({ host: wrap, mapId, store, getState: () => state, applyState: (s) => setState(s), navigate });

  // ------------------------------ Helpers ---------------------------------
  const folderById = (id) => state?.folders.find((f) => f.id === id);
  const tasksOf = (fid) => state.tasks.filter((t) => t.folder_id === fid);
  const memberById = (id) => state.members.find((m) => m.id === id);
  const isOnline = (uid) => state.online.includes(uid);

  function setState(s) {
    // On conserve la position locale d'un dossier en cours de deplacement
    if (gesture?.type === 'folder' && gesture.moved) {
      const local = folderById(gesture.id);
      const f = s.folders.find((x) => x.id === gesture.id);
      if (f && local) Object.assign(f, { x: local.x, y: local.y });
    }
    state = s;
    renderAll();
  }

  function renderAll() {
    if (!state) return;
    titleEl.textContent = state.map.name;
    document.title = `${state.map.name} — Orbit`;
    renderCore();
    renderOrbit();
    renderFolders();
    renderEdges();
    renderTopMembers();
    if (pinnedMember) focusMember(pinnedMember, true);
    board.update();
    web.update();
  }

  function renderCore() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    coreTitle.textContent = state.map.name;
    corePct.textContent = total ? `${pct}% terminé` : `${state.members.length} membre${state.members.length > 1 ? 's' : ''}`;
    ring.style.strokeDasharray = `${pct} 100`;
    ring.style.opacity = pct ? '1' : '0';
  }

  function orbitRadius() {
    return Math.max(132, (state.members.length * 52) / (2 * Math.PI));
  }

  function memberPos(i, n) {
    const R = orbitRadius();
    // Depart en diagonale : les liens vers les dossiers partent a l'horizontale
    const a = (-3 * Math.PI) / 4 + (i / n) * Math.PI * 2;
    return { x: Math.cos(a) * R, y: Math.sin(a) * R };
  }

  function renderOrbit() {
    const n = state.members.length;
    const R = orbitRadius();
    orbit.style.setProperty('--R', R + 'px');
    mount(
      orbit,
      h('div.orbit-ring'),
      state.members.map((m, i) => {
        const p = memberPos(i, n);
        const el = h(
          'button.orb',
          {
            style: { left: p.x + 'px', top: p.y + 'px', '--d': (i % 5) * 0.6 + 's' },
            dataset: { uid: m.id },
            'aria-label': m.pseudo,
            class: pinnedMember === m.id ? 'pinned' : '',
            onmouseenter: () => !pinnedMember && focusMember(m.id),
            onmouseleave: () => !pinnedMember && unfocus(),
            onfocus: () => !pinnedMember && focusMember(m.id),
            onblur: () => !pinnedMember && unfocus(),
            onclick: (e) => {
              e.stopPropagation();
              if (pinnedMember === m.id) {
                pinnedMember = null;
                unfocus();
                renderOrbit();
              } else {
                pinnedMember = m.id;
                renderOrbit();
                focusMember(m.id, true);
              }
            },
          },
          avatar(m, { size: 42, online: isOnline(m.id), title: false }),
          m.role === 'owner' && h('span.orb-crown', icon('crown', 11))
        );
        return el;
      })
    );
  }

  function folderStats(fid) {
    const ts = tasksOf(fid);
    const done = ts.filter((t) => t.done).length;
    const assignees = [...new Set(ts.map((t) => t.assignee_id).filter(Boolean))].map(memberById).filter(Boolean);
    return { total: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : 0, assignees, unassigned: ts.filter((t) => !t.assignee_id && !t.done).length };
  }

  function renderFolders() {
    const seen = new Set();
    state.folders.forEach((f, i) => {
      seen.add(f.id);
      let rec = folderEls.get(f.id);
      if (!rec) {
        const el = h('div.fnode', { dataset: { id: f.id } });
        nodesLayer.append(el);
        rec = { el };
        folderEls.set(f.id, rec);
        el.classList.add(firstLoad ? 'intro' : 'pop');
        el.style.animationDelay = firstLoad ? 120 + i * 60 + 'ms' : '0ms';
      }
      const s = folderStats(f.id);
      const el = rec.el;
      el.style.left = f.x + 'px';
      el.style.top = f.y + 'px';
      el.style.setProperty('--c', f.color);
      el.classList.toggle('complete', s.total > 0 && s.done === s.total);
      const more = h('button.fmore', { 'aria-label': 'Options du dossier', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); folderMenu(more, f); } }, icon('more', 16));
      mount(
        el,
        h(
          'div.fcard',
          h('div.fhead', h('span.ficon', icon('folder', 16)), h('h3.ftitle', f.title), more),
          h(
            'div.fprog',
            h('div.bar', h('i', { style: { width: s.pct + '%' } })),
            h('span', s.total ? `${s.pct}%` : '')
          ),
          h(
            'div.ffoot',
            s.assignees.length ? avatarStack(s.assignees, { max: 4, size: 24 }) : h('span.fnone', s.total ? 'Non assignée' : 'Vide pour l’instant'),
            h('span.fcount', s.total ? `${s.done}/${s.total}` : '', s.total > 0 && s.done === s.total && icon('check', 13))
          )
        )
      );
    });
    for (const [id, rec] of folderEls) {
      if (!seen.has(id)) {
        rec.el.classList.add('leaving');
        setTimeout(() => rec.el.remove(), 260);
        folderEls.delete(id);
      }
    }
    // Invitation a creer le premier dossier
    ghost.hidden = state.folders.length > 0;
    hint.classList.toggle('show', state.folders.length < 3);
  }

  const edgePath = (x0, y0, x, y) => {
    const mx = (x0 + x) / 2;
    return `M${x0} ${y0} C ${mx} ${y0}, ${mx} ${y}, ${x} ${y}`;
  };

  function renderEdges() {
    const seen = new Set();
    for (const f of state.folders) {
      seen.add(f.id);
      const rec = folderEls.get(f.id);
      if (!rec.edge) {
        rec.edge = svg('path', { class: 'edge intro', pathLength: 1 });
        rec.edge.style.animationDelay = firstLoad ? '250ms' : '0ms';
        edgesG.append(rec.edge);
      }
      rec.edge.setAttribute('d', edgePath(0, 0, f.x, f.y));
      rec.edge.style.stroke = f.color;
    }
    for (const p of [...edgesG.children]) if (!state.folders.some((f) => folderEls.get(f.id)?.edge === p)) p.remove();
  }

  function updateFolderPos(f) {
    const rec = folderEls.get(f.id);
    if (!rec) return;
    rec.el.style.left = f.x + 'px';
    rec.el.style.top = f.y + 'px';
    rec.edge?.setAttribute('d', edgePath(0, 0, f.x, f.y));
  }

  // Deplacement fluide d'un dossier bouge par quelqu'un d'autre
  function glideTo(id, x, y) {
    const f = folderById(id);
    if (!f || (gesture?.type === 'folder' && gesture.id === id)) return;
    const x0 = f.x, y0 = f.y;
    const t0 = performance.now();
    const D = 420;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / D);
      const e = 1 - Math.pow(1 - k, 3);
      f.x = x0 + (x - x0) * e;
      f.y = y0 + (y - y0) * e;
      updateFolderPos(f);
      if (pinnedMember) drawLinks(pinnedMember);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderTopMembers() {
    const online = state.online.filter((id) => id !== store.user.id).length;
    mount(
      membersEl,
      avatarStack(state.members, { max: 4, size: 30, online: state.online }),
      h('span.top-members-label', online ? `${online} en ligne` : `${state.members.length} membre${state.members.length > 1 ? 's' : ''}`)
    );
  }

  // ----------------------- Focus sur un membre ------------------------------
  function focusMember(uid, pinned = false) {
    const m = memberById(uid);
    if (!m) return unfocus();
    const mine = state.tasks.filter((t) => t.assignee_id === uid);
    const folders = new Set(mine.map((t) => t.folder_id));
    stage.classList.add('focusing');
    for (const [id, rec] of folderEls) {
      rec.el.classList.toggle('hl', folders.has(id));
      rec.edge?.classList.toggle('dim', !folders.has(id));
    }
    drawLinks(uid);

    const done = mine.filter((t) => t.done).length;
    const names = state.folders.filter((f) => folders.has(f.id)).map((f) => f.title);
    mount(
      tip,
      h('div.tip-head', avatar(m, { size: 30, online: isOnline(m.id), title: false }), h('div', h('b', m.pseudo, m.id === store.user.id ? ' (toi)' : ''), h('small', isOnline(m.id) ? 'En ligne' : 'Hors ligne'))),
      h('p', mine.length ? `${mine.length - done} en cours · ${done} terminée${done > 1 ? 's' : ''}` : 'Aucune tâche assignée'),
      names.length > 0 && h('div.tip-folders', names.slice(0, 4).map((n) => h('span.chip', n)), names.length > 4 && h('span.chip', `+${names.length - 4}`)),
      pinned && h('small.tip-hint', 'Clique à nouveau pour relâcher')
    );
    const orbEl = orbit.querySelector(`.orb[data-uid="${uid}"]`);
    if (orbEl) {
      const r = orbEl.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      tip.style.left = clamp(r.left + r.width / 2 - wr.left, 140, wr.width - 140) + 'px';
      tip.style.top = r.bottom - wr.top + 10 + 'px';
    }
    tip.classList.add('show');
  }

  function drawLinks(uid) {
    linksG.replaceChildren();
    const m = memberById(uid);
    if (!m) return;
    const i = state.members.indexOf(m);
    const p = memberPos(i, state.members.length);
    const folders = new Set(state.tasks.filter((t) => t.assignee_id === uid).map((t) => t.folder_id));
    for (const f of state.folders) {
      if (!folders.has(f.id)) continue;
      linksG.append(svg('path', { d: edgePath(p.x, p.y, f.x, f.y), class: 'link', style: `stroke:${m.color}` }));
    }
  }

  function unfocus() {
    stage.classList.remove('focusing');
    for (const rec of folderEls.values()) {
      rec.el.classList.remove('hl');
      rec.edge?.classList.remove('dim');
    }
    linksG.replaceChildren();
    tip.classList.remove('show');
  }

  // ----------------------------- Vue / camera -------------------------------
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const g = 26 * view.z;
    stage.style.backgroundSize = `${g}px ${g}px`;
    stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomLabel.textContent = Math.round(view.z * 100) + '%';
    if (tip.classList.contains('show')) tip.classList.remove('show');
  }

  function stageSize() {
    const r = stage.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  }

  function zoomAt(factor, cx, cy) {
    const z = clamp(view.z * factor, ZMIN, ZMAX);
    const k = z / view.z;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.z = z;
    applyView();
  }

  // Garde le centre de l'ecran fixe en passant du zoom z0 a z1
  function centerOn(z0, z1) {
    const { w, h: hh } = stageSize();
    const cx = w / 2, cy = hh / 2;
    const k = z1 / z0;
    return { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
  }

  function zoomBy(f) {
    const z = clamp(view.z * f, ZMIN, ZMAX);
    animateView({ z, ...centerOn(view.z, z) });
  }

  let viewAnim = 0;
  function animateView(target, D = 360) {
    if (prefersReducedMotion()) D = 1;
    const from = { ...view };
    const t0 = performance.now();
    const id = ++viewAnim;
    const step = (t) => {
      if (id !== viewAnim) return;
      const k = Math.min(1, (t - t0) / D);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      view.x = from.x + (target.x - from.x) * e;
      view.y = from.y + (target.y - from.y) * e;
      view.z = from.z + (target.z - from.z) * e;
      applyView();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function fitView(animated) {
    const { w, h: hh } = stageSize();
    if (!w || !hh) return;
    const R = state ? orbitRadius() + 40 : 170;
    let minX = -R, maxX = R, minY = -R, maxY = R;
    for (const f of state?.folders || []) {
      minX = Math.min(minX, f.x - 130);
      maxX = Math.max(maxX, f.x + 130);
      minY = Math.min(minY, f.y - 80);
      maxY = Math.max(maxY, f.y + 80);
    }
    if (!state?.folders.length) maxX = Math.max(maxX, 480);
    const z = clamp(Math.min((w - 40) / (maxX - minX), (hh - 150) / (maxY - minY)), w < 600 ? 0.28 : 0.4, 1.05);
    const target = { z, x: w / 2 - ((minX + maxX) / 2) * z, y: (hh - 40) / 2 - ((minY + maxY) / 2) * z };
    if (animated) animateView(target, 520);
    else {
      Object.assign(view, target);
      applyView();
    }
  }

  const screenToWorld = (cx, cy) => {
    const s = stageSize();
    return { x: (cx - s.left - view.x) / view.z, y: (cy - s.top - view.y) / view.z };
  };

  function getFolderRect(fid) {
    const f = folderById(fid);
    const rec = folderEls.get(fid);
    const s = stageSize();
    if (!f || !rec) return { left: s.left + s.w / 2 - 110, top: s.top + s.h / 2 - 60, width: 220, height: 120 };
    const card = rec.el.querySelector('.fcard') || rec.el;
    const w = card.offsetWidth * view.z;
    const hh = card.offsetHeight * view.z;
    return { left: s.left + view.x + f.x * view.z - w / 2, top: s.top + view.y + f.y * view.z - hh / 2, width: w, height: hh };
  }

  // Plongee 3D de la camera vers un dossier (ou retour)
  let diveFrames = null;
  let diveAnim = null;
  function dive(fid, entering, D) {
    const tf = (v) => `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    if (entering) {
      const f = folderById(fid);
      const { w, h: hh } = stageSize();
      const cx = w / 2, cy = hh / 2;
      const z2 = clamp(view.z * 2, 1.3, 2.8);
      const target = f ? { x: cx - f.x * z2, y: cy - f.y * z2, z: z2 } : { ...view };
      const mid = { x: (view.x + target.x) / 2, y: (view.y + target.y) / 2, z: (view.z + target.z) / 2 };
      const tilt = (deg) => `translate(${cx}px, ${cy}px) rotateX(${deg}deg) translate(${-cx}px, ${-cy}px) `;
      diveFrames = [
        { transform: tilt(0) + tf(view), filter: 'blur(0px) saturate(1)', opacity: 1 },
        { transform: tilt(18) + tf(mid), filter: 'blur(1px) saturate(.9)', opacity: 0.85, offset: 0.5 },
        { transform: tilt(0) + tf(target), filter: 'blur(4px) saturate(.6)', opacity: 0.25 },
      ];
      diveAnim?.cancel();
      diveAnim = world.animate(diveFrames, { duration: D, easing: 'cubic-bezier(.65,.05,.25,1)', fill: 'forwards' });
      stage.classList.add('dived');
    } else if (diveFrames) {
      const frames = [...diveFrames].reverse().map((k) => ({ ...k, offset: k.offset !== undefined ? 1 - k.offset : undefined }));
      frames.forEach((k) => k.offset === undefined && delete k.offset);
      diveAnim?.cancel();
      const a = world.animate(frames, { duration: D, easing: 'cubic-bezier(.65,.05,.25,1)', fill: 'forwards' });
      diveAnim = a;
      a.finished.then(() => {
        if (diveAnim === a) {
          a.cancel();
          diveAnim = null;
        }
      }).catch(() => {});
      stage.classList.remove('dived');
    }
  }

  // --------------------------- Interactions ---------------------------------
  const pointers = new Map();

  stage.addEventListener('pointerdown', (e) => {
    if (board.isOpen() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('.fmore, .orb, .core, .ghost-folder')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { stage.setPointerCapture(e.pointerId); } catch {}
    viewAnim++;

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: view.z, moved: true };
      return;
    }
    const fEl = e.target.closest('.fnode');
    if (fEl) {
      const f = folderById(Number(fEl.dataset.id));
      if (!f) return;
      gesture = { type: 'folder', id: f.id, el: fEl, sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y, moved: false };
    } else {
      gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture.type === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = stageSize();
      zoomAt((gesture.z0 * (d / gesture.d0)) / view.z, (a.x + b.x) / 2 - s.left, (a.y + b.y) / 2 - s.top);
      return;
    }
    const dx = e.clientX - gesture.sx;
    const dy = e.clientY - gesture.sy;
    if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
    if (!gesture.moved) {
      gesture.moved = true;
      if (gesture.type === 'folder') gesture.el.classList.add('dragging');
      else stage.classList.add('panning');
      if (!pinnedMember) unfocus();
    }
    if (gesture.type === 'folder') {
      const f = folderById(gesture.id);
      if (!f) return;
      f.x = gesture.ox + dx / view.z;
      f.y = gesture.oy + dy / view.z;
      updateFolderPos(f);
      if (pinnedMember) drawLinks(pinnedMember);
    } else {
      view.x = gesture.vx + dx;
      view.y = gesture.vy + dy;
      applyView();
    }
  });

  const endPointer = async (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (g?.type === 'pinch') {
      if (pointers.size === 0) gesture = null;
      return;
    }
    gesture = null;
    stage.classList.remove('panning');
    if (!g) return;
    if (g.type === 'folder') {
      g.el.classList.remove('dragging');
      if (g.moved) {
        const f = folderById(g.id);
        if (!f) return;
        try {
          await api.patch(`/api/folders/${g.id}`, { x: f.x, y: f.y });
        } catch (err) {
          toast(err.message, 'err');
          load();
        }
      } else if (e.type === 'pointerup') {
        navigate(`/carte/${mapId}/dossier/${g.id}`);
      }
    } else if (!g.moved && pinnedMember && e.type === 'pointerup') {
      pinnedMember = null;
      unfocus();
      renderOrbit();
    }
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  stage.addEventListener(
    'wheel',
    (e) => {
      if (board.isOpen()) return;
      e.preventDefault();
      viewAnim++;
      const s = stageSize();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      zoomAt(factor, e.clientX - s.left, e.clientY - s.top);
    },
    { passive: false }
  );

  stage.addEventListener('dblclick', (e) => {
    if (board.isOpen() || e.target.closest('.fnode, .orb, .core, .ghost-folder')) return;
    createFolder(screenToWorld(e.clientX, e.clientY));
  });

  const onKey = (e) => {
    if (hasOpenModal() || board.isOpen() || web.isVisible() || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); createFolder(); }
    else if (e.key === 'f' || e.key === 'F') fitView(true);
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(1 / 1.25);
  };
  document.addEventListener('keydown', onKey);

  const onResize = debounce(() => !board.isOpen() && applyView(), 100);
  window.addEventListener('resize', onResize);

  // ------------------------------ Dossiers ----------------------------------
  function nextColor() {
    const used = state.folders.map((f) => f.color);
    const order = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9', '#f43f5e', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];
    return order.find((c) => !used.includes(c)) || order[state.folders.length % order.length];
  }

  // Trouve une place libre autour du noeud central (anneaux elliptiques)
  function freeSpot() {
    const ok = (x, y) => Math.hypot(x, y * 1.4) > 300 && state.folders.every((f) => Math.abs(f.x - x) > 250 || Math.abs(f.y - y) > 150);
    for (let ring = 0; ring < 6; ring++) {
      const rx = 360 + ring * 220;
      const ry = 210 + ring * 150;
      const steps = 8 + ring * 4;
      for (let k = 0; k < steps; k++) {
        const idx = k % 2 ? Math.ceil(k / 2) : -Math.ceil(k / 2);
        const a = (idx / steps) * Math.PI * 2 + (ring % 2 ? Math.PI / steps : 0);
        for (const side of [0, Math.PI]) {
          const x = Math.round(Math.cos(a + side) * rx);
          const y = Math.round(Math.sin(a + side) * ry);
          if (ok(x, y)) return { x, y };
        }
      }
    }
    return { x: 400 + Math.random() * 200, y: Math.random() * 200 - 100 };
  }

  async function createFolder(at) {
    if (!state) return;
    const colors = colorPicker(nextColor());
    const r = await promptDialog({
      title: 'Nouveau dossier',
      label: 'Nom du dossier',
      placeholder: 'ex : Rapport final',
      confirmLabel: 'Créer le dossier',
      extra: { node: h('div.field', h('span.field-label', 'Couleur'), colors.node), value: colors.value },
    });
    if (!r) return;
    const pos = at || freeSpot();
    try {
      const res = await api.post(`/api/maps/${mapId}/folders`, { title: r.value, color: r.extra, x: pos.x, y: pos.y });
      setState(res.state);
      // Si le dossier est hors champ, on recadre en douceur
      const rect = getFolderRect(res.folderId);
      const s = stageSize();
      if (rect.left < s.left || rect.top < s.top || rect.left + rect.width > s.left + s.w || rect.top + rect.height > s.top + s.h) fitView(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function folderMenu(anchor, f) {
    const picker = colorPicker(f.color, async (c) => {
      try {
        setState((await api.patch(`/api/folders/${f.id}`, { color: c })).state);
      } catch (e) {
        toast(e.message, 'err');
      }
    });
    menu(anchor, [
      { icon: 'arrow', label: 'Ouvrir', onClick: () => navigate(`/carte/${mapId}/dossier/${f.id}`) },
      { icon: 'edit', label: 'Renommer', onClick: () => renameFolder(f) },
      { node: h('div.menu-colors', h('small', 'Couleur'), picker.node) },
      'sep',
      { icon: 'trash', label: 'Supprimer', danger: true, onClick: () => deleteFolder(f) },
    ]);
  }

  async function renameFolder(f) {
    const r = await promptDialog({ title: 'Renommer le dossier', label: 'Nom du dossier', value: f.title, confirmLabel: 'Renommer' });
    if (!r) return;
    try {
      setState((await api.patch(`/api/folders/${f.id}`, { title: r.value })).state);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function deleteFolder(f) {
    const n = tasksOf(f.id).length;
    const ok = await confirmDialog({
      title: 'Supprimer le dossier ?',
      message: n ? `« ${f.title} » et ses ${n} tâche${n > 1 ? 's' : ''} seront supprimés pour tout le monde.` : `Le dossier « ${f.title} » sera supprimé.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      setState((await api.del(`/api/folders/${f.id}`)).state);
      toast('Dossier supprimé', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  // ------------------------------- Carte ------------------------------------
  async function renameMap() {
    if (!state) return;
    const r = await promptDialog({ title: 'Renommer la carte', label: 'Nom du projet', value: state.map.name, confirmLabel: 'Renommer' });
    if (!r) return;
    try {
      setState((await api.patch(`/api/maps/${mapId}`, { name: r.value })).state);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function mapMenu() {
    if (!state) return;
    menu(moreBtn, [
      { icon: 'edit', label: 'Renommer la carte', onClick: renameMap },
      { icon: 'users', label: 'Équipe et invitations', onClick: openTeam },
      { icon: 'target', label: 'Tout afficher', onClick: () => fitView(true) },
      'sep',
      role === 'owner'
        ? { icon: 'trash', label: 'Supprimer la carte', danger: true, onClick: deleteMap }
        : { icon: 'door', label: 'Quitter la carte', danger: true, onClick: () => removeMember(store.user.id) },
    ], { align: 'left' });
  }

  async function deleteMap() {
    const ok = await confirmDialog({
      title: 'Supprimer la carte ?',
      message: `« ${state.map.name} » et tout son contenu seront supprimés pour tous les membres. C’est définitif.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      leaving = true;
      await api.del(`/api/maps/${mapId}`);
      toast('Carte supprimée', 'ok');
      navigate('/', { replace: true });
    } catch (e) {
      leaving = false;
      toast(e.message, 'err');
    }
  }

  async function removeMember(uid, onDone) {
    const self = uid === store.user.id;
    const m = memberById(uid);
    const ok = await confirmDialog(
      self
        ? { title: 'Quitter la carte ?', message: 'Tu n’y auras plus accès et tes tâches seront désassignées.', confirmLabel: 'Quitter', danger: true }
        : { title: `Retirer ${m?.pseudo} ?`, message: 'Ses tâches sur cette carte seront désassignées.', confirmLabel: 'Retirer', danger: true }
    );
    if (!ok) return;
    try {
      if (self) leaving = true;
      const r = await api.del(`/api/maps/${mapId}/members/${uid}`);
      if (self) {
        toast('Tu as quitté la carte', 'ok');
        return navigate('/', { replace: true });
      }
      setState(r.state);
      toast(`${m?.pseudo} a été retiré`, 'ok');
      onDone?.();
    } catch (e) {
      leaving = false;
      toast(e.message, 'err');
    }
  }

  // ------------------------- Equipe & invitations ---------------------------
  let teamModal = null;
  function openTeam() {
    if (!state || teamModal) return;
    const input = h('input.input', { placeholder: 'Pseudo de la personne à inviter', maxLength: 24, autocomplete: 'off', autofocus: true, spellcheck: false });
    const results = h('div.search-results');
    const membersList = h('div.team-list');
    const pendingList = h('div.team-list');
    const pendingBlock = h('div.team-block', h('h4', 'Invitations en attente'), pendingList);

    async function invite(pseudo) {
      try {
        const r = await api.post(`/api/maps/${mapId}/invitations`, { pseudo });
        toast(`Invitation envoyée à ${r.pseudo} 🔔`, 'ok');
        input.value = '';
        results.replaceChildren();
        loadPending();
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    const search = debounce(async () => {
      const q = input.value.trim();
      if (!q) return results.replaceChildren();
      try {
        const { users } = await api.get(`/api/users/search?map=${mapId}&q=${encodeURIComponent(q)}`);
        if (input.value.trim() !== q) return;
        if (!users.length) return mount(results, h('div.search-empty', `Aucun utilisateur ne commence par « ${q} »`));
        mount(
          results,
          users.map((u) =>
            h(
              'div.search-row',
              avatar(u, { size: 30 }),
              h('b', u.pseudo),
              u.status === 'member'
                ? h('span.pill', 'Membre')
                : u.status === 'invited'
                  ? h('span.pill', 'Invité')
                  : h('button.btn.btn-primary.btn-sm', { onclick: () => invite(u.pseudo) }, 'Inviter')
            )
          )
        );
      } catch {}
    }, 200);
    input.addEventListener('input', search);

    function renderMembers() {
      if (!state) return;
      mount(
        membersList,
        state.members.map((m) =>
          h(
            'div.team-row',
            avatar(m, { size: 34, online: isOnline(m.id) }),
            h('div.team-name', h('b', m.pseudo, m.id === store.user.id && h('span.you', ' (toi)')), h('small', m.role === 'owner' ? 'Créateur de la carte' : `A rejoint ${timeAgo(m.joined_at)}`)),
            m.role === 'owner' && h('span.pill.pill-accent', icon('crown', 12), 'Créateur'),
            role === 'owner' && m.id !== store.user.id && h('button.btn.btn-ghost.btn-sm.danger-text', { onclick: () => removeMember(m.id, renderMembers) }, 'Retirer'),
            role !== 'owner' && m.id === store.user.id && h('button.btn.btn-ghost.btn-sm.danger-text', { onclick: () => removeMember(m.id) }, 'Quitter')
          )
        )
      );
    }

    async function loadPending() {
      try {
        const { invitations } = await api.get(`/api/maps/${mapId}/invitations`);
        pendingBlock.hidden = !invitations.length;
        mount(
          pendingList,
          invitations.map((i) =>
            h(
              'div.team-row',
              avatar({ pseudo: i.pseudo, color: i.color }, { size: 34 }),
              h('div.team-name', h('b', i.pseudo), h('small', `Invité par ${i.inviter} · ${timeAgo(i.created_at)}`)),
              h('span.pill.pill-warn', icon('clock', 12), 'En attente'),
              h('button.btn.btn-ghost.btn-sm', {
                onclick: async () => {
                  try {
                    await api.del(`/api/invitations/${i.id}`);
                    loadPending();
                  } catch (e) {
                    toast(e.message, 'err');
                  }
                },
              }, 'Annuler')
            )
          )
        );
      } catch {}
    }

    const body = h(
      'div.team',
      h(
        'form.invite-form',
        { onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) invite(input.value.trim()); } },
        h('div.input-wrap', h('span.input-icon', icon('search', 17)), input),
        h('button.btn.btn-primary', { type: 'submit' }, 'Inviter')
      ),
      h('small.field-hint', 'La personne recevra une notification sur la cloche 🔔 pour accepter ou refuser.'),
      results,
      h('div.team-block', h('h4', 'Membres'), membersList),
      pendingBlock
    );

    renderMembers();
    pendingBlock.hidden = true;
    loadPending();
    const off = on('map', (d) => d.mapId === mapId && setTimeout(() => { renderMembers(); loadPending(); }, 200));
    teamModal = modal({
      title: 'Équipe',
      subtitle: `Tout le monde sur « ${state.map.name} » peut modifier la carte.`,
      body,
      width: 520,
      onClose: () => { off(); teamModal = null; },
    });
  }

  // ------------------------------ Chargement --------------------------------
  async function load() {
    try {
      const r = await api.get(`/api/maps/${mapId}`);
      role = r.role;
      setState(r.state);
      if (firstLoad) {
        fitView(false);
        layout.classList.add('loaded');
        firstLoad = false;
        if (ctx.params.view === 'besoins') applyRoute(ctx.params);
        else if (ctx.params.fid) setTimeout(() => openFolder(ctx.params.fid), 700);
      }
    } catch (e) {
      if (e.status === 404) {
        toast('Carte introuvable ou accès retiré', 'err');
        navigate('/', { replace: true });
      } else toast(e.message, 'err');
    }
  }
  const reload = debounce(load, 120);

  function openFolder(fid) {
    if (!state) return;
    if (!folderById(fid)) {
      toast('Ce dossier n’existe plus', 'info');
      return navigate(`/carte/${mapId}`, { replace: true });
    }
    unfocus();
    pinnedMember = null;
    board.open(fid);
  }

  const offs = [
    on('map', (d) => {
      if (d.mapId !== mapId || isOwnEvent(d)) return;
      if (d.joined) toast(`${d.joined} a rejoint la carte 🎉`, 'ok');
      reload();
    }),
    on('moved', (d) => d.mapId === mapId && !isOwnEvent(d) && glideTo(d.id, d.x, d.y)),
    on('presence', (d) => {
      if (d.mapId !== mapId || !state) return;
      state.online = d.online;
      renderOrbit();
      renderTopMembers();
    }),
    on('kicked', (d) => {
      if (d.mapId !== mapId || leaving) return;
      toast('Tu n’as plus accès à cette carte', 'info');
      navigate('/', { replace: true });
    }),
    on('reconnect', () => reload()),
  ];

  function setViewUI(v) {
    viewSeg.dataset.v = v;
    for (const b of viewSeg.querySelectorAll('.view-btn')) b.setAttribute('aria-selected', String(b.dataset.v === v));
    wrap.classList.toggle('web-mode', v === 'besoins');
  }

  function applyRoute(p) {
    if (p.view === 'besoins') {
      if (board.isOpen()) board.close();
      setViewUI('besoins');
      if (state) web.show(p.nid ?? null);
    } else {
      setViewUI('taches');
      web.hide();
      if (p.fid) {
        if (board.folderId() !== p.fid) openFolder(p.fid);
      } else if (board.isOpen()) board.close();
    }
  }

  setViewUI(ctx.params.view === 'besoins' ? 'besoins' : 'taches');
  applyView();
  load();

  return {
    onRoute: applyRoute,
    destroy() {
      offs.forEach((f) => f());
      web.destroy();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      board.destroy();
      teamModal?.close();
      topbar.destroy();
      document.title = 'Orbit — Répartissez les tâches de votre groupe';
    },
  };
}
