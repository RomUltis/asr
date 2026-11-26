// ---------------------------------------------------------------------------
//  Toile des besoins en 3D
//  Moteur maison sur <canvas> : projection perspective, camera orbitale,
//  disposition par forces en 3D, champ d'etoiles en fond.
//  - Racine : le projet au centre, ses besoins, ce qu'il faut pour chacun.
//  - Clic sur un element : on "plonge" dedans et sa propre toile se deploie.
// ---------------------------------------------------------------------------
import { api } from '../api.js';
import { h, mount, icon, toast, modal, avatar, confirmDialog, promptDialog, debounce, hasOpenModal, prefersReducedMotion } from '../ui.js';

export const KINDS = {
  besoin: { label: 'Besoin', color: '#a5b4fc', core: '#eef2ff', r: 12 },
  solution: { label: 'À mettre en place', color: '#fbbf24', core: '#fef3c7', r: 7.5 },
  contrainte: { label: 'Contrainte', color: '#f87171', core: '#fee2e2', r: 7 },
};
const DONE = '#34d399';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const truncate = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function createWeb({ host, mapId, store, getState, applyState, navigate }) {
  let visible = false;
  let focus = null; // id du noeud au centre, ou null = projet
  let graph = { nodes: [], edges: [], byKey: new Map() };
  const posCache = new Map();
  let simAlpha = 1;
  let raf = 0;
  let lastT = 0;
  let fade = 1;
  let bloom = 1; // facteur d'echelle global : la toile "eclot" de 0 a 1
  let busy = false;
  let hoverKey = null;
  let panelHoverKey = null;
  let lastInteract = 0;
  let pendingPanel = false;
  let panelOpen = innerWidth > 900;
  let focusPath = []; // ids de la racine jusqu'au centre (pour remonter si le centre disparait)
  let deletedByMe = null;

  const cam = { yaw: 0.5, pitch: -0.28, dist: 900, autoDist: 900, zoom: 1, tx: 0, ty: 0, tz: 0 };

  // ------------------------------- DOM -------------------------------------
  const canvas = h('canvas.web-canvas');
  const ctx = canvas.getContext('2d');
  const crumbs = h('nav.web-crumbs', { 'aria-label': 'Chemin' });
  const counter = h('div.web-counter');
  const tip = h('div.web-tip');
  const panelBody = h('div.web-panel-body');
  const panel = h('aside.web-panel', panelBody);
  // Un champ du panneau perd le focus : on applique la mise a jour mise en attente
  panel.addEventListener('focusout', () => setTimeout(() => pendingPanel && !panel.contains(document.activeElement) && renderPanel()));
  const panelToggle = h('button.web-panel-toggle', { onclick: () => setPanel(!panelOpen), 'aria-label': 'Afficher le panneau' }, icon('text', 18));
  const empty = h(
    'div.web-empty',
    h('div.web-empty-star', icon('sparkles', 26)),
    h('h3', 'La toile est vide'),
    h('p', 'Ajoute les besoins du projet : chacun devient une étoile. Ensuite, plonge dedans pour y relier tout ce qu’il faut mettre en place.'),
    h('button.btn.btn-primary', { onclick: () => addNode() }, icon('plus', 16), 'Ajouter un besoin')
  );
  const legend = h(
    'div.web-legend',
    Object.entries(KINDS).map(([k, v]) => h('span', h('i', { class: 'lg-' + k, style: { '--c': v.color } }), v.label)),
    h('span', h('i.lg-done', { style: { '--c': DONE } }), 'Validé / en place'),
    h('span', h('i.lg-member'), 'Membre')
  );
  const hint = h('div.web-hint', 'Glisser pour tourner · Molette pour zoomer · Clic sur une étoile pour plonger dedans');
  const addBtn = h('button.web-add', { onclick: () => addNode(), 'aria-label': 'Ajouter un élément', title: 'Ajouter un élément' }, icon('plus', 22));
  const el = h('section.web', { hidden: true }, canvas, h('div.web-top', crumbs, counter), legend, hint, empty, addBtn, panelToggle, panel, tip);
  host.append(el);

  // Champ d'etoiles (fond, parallaxe avec la rotation)
  const stars = Array.from({ length: 420 }, () => {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = 2600 + Math.random() * 2600;
    const s = Math.sqrt(1 - u * u);
    return { x: Math.cos(a) * s * r, y: u * r, z: Math.sin(a) * s * r, size: 0.4 + Math.random() * 1.3, tw: Math.random() * Math.PI * 2 };
  });

  // ------------------------------ Donnees ----------------------------------
  const S = () => getState();
  const nodeById = (id) => S().nodes.find((n) => n.id === id);
  const member = (id) => S().members.find((m) => m.id === id);

  function childrenMap() {
    const m = new Map();
    for (const n of S().nodes) {
      const k = n.parent_id ?? 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(n);
    }
    return m;
  }

  function descendantsCount(id, kids = childrenMap()) {
    let c = 0;
    const stack = [...(kids.get(id) || [])];
    while (stack.length) {
      const n = stack.pop();
      c++;
      stack.push(...(kids.get(n.id) || []));
    }
    return c;
  }

  function ancestors(id) {
    const out = [];
    let cur = nodeById(id);
    let guard = 0;
    while (cur && guard++ < 200) {
      out.unshift(cur);
      cur = cur.parent_id ? nodeById(cur.parent_id) : null;
    }
    return out;
  }

  function progressOf(id, kids) {
    const list = kids.get(id) || [];
    return { done: list.filter((n) => n.done).length, total: list.length };
  }

  // Construit la toile visible pour le noeud au centre
  function buildGraph() {
    const s = S();
    const kids = childrenMap();
    const g = { nodes: [], edges: [], byKey: new Map() };

    const add = (key, props, near) => {
      if (g.byKey.has(key)) return g.byKey.get(key);
      let p = posCache.get(key);
      if (!p) {
        const base = near && (posCache.get(near.key) || near);
        const spread = props.depth === 0 ? 0 : 40 + props.depth * 30;
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const q = Math.sqrt(1 - u * u);
        p = {
          x: (base?.x || 0) + Math.cos(a) * q * spread,
          y: (base?.y || 0) + u * spread,
          z: (base?.z || 0) + Math.sin(a) * q * spread,
          vx: 0, vy: 0, vz: 0,
        };
        posCache.set(key, p);
      }
      const n = Object.assign(p, { key, ...props });
      g.nodes.push(n);
      g.byKey.set(key, n);
      return n;
    };
    const edge = (a, b, type, len) => g.edges.push({ a, b, type, len });

    const nodeProps = (n, depth) => {
      const k = KINDS[n.kind] || KINDS.besoin;
      const pr = progressOf(n.id, kids);
      return {
        type: 'node',
        id: n.id,
        depth,
        kind: n.kind,
        title: n.title,
        done: n.done,
        assignee: n.assignee_id,
        color: k.color,
        core: k.core,
        r: depth === 0 ? 22 : depth === 1 ? k.r * (n.kind === 'besoin' ? 1.1 : 1.25) : k.r * 0.85,
        inside: pr.total,
        insideDone: pr.done,
        ghost: false,
      };
    };

    if (focus != null && !nodeById(focus)) focus = null;
    let center;
    if (focus == null) {
      const total = s.nodes.filter((n) => n.kind === 'besoin').length;
      const done = s.nodes.filter((n) => n.kind === 'besoin' && n.done).length;
      center = add('root', { type: 'root', depth: 0, title: s.map.name, r: 26, color: '#c4b5fd', core: '#ffffff', inside: total, insideDone: done });
    } else {
      const f = nodeById(focus);
      center = add('n' + f.id, nodeProps(f, 0));
      center.r = 24;
    }
    center.x = center.y = center.z = 0;
    center.pinned = true;

    const lvl1 = kids.get(focus ?? 0) || [];
    for (const n of lvl1) {
      const a = add('n' + n.id, nodeProps(n, 1), center);
      edge(center, a, 'tree', n.kind === 'besoin' ? 300 : 220);
      for (const c of kids.get(n.id) || []) {
        const b = add('n' + c.id, nodeProps(c, 2), a);
        edge(a, b, 'tree', 125);
      }
    }

    // Liens transverses : on montre aussi les elements relies (en "fantome")
    for (const l of s.links) {
      const A = g.byKey.get('n' + l.source_id);
      const B = g.byKey.get('n' + l.target_id);
      if (A && B) edge(A, B, 'link', 200);
      else if (A || B) {
        const known = A || B;
        if (known.depth > 1) continue;
        const otherId = A ? l.target_id : l.source_id;
        const o = nodeById(otherId);
        if (!o) continue;
        const gnode = add('n' + o.id, { ...nodeProps(o, 3), ghost: true }, known);
        edge(known, gnode, 'link', 230);
      }
    }

    // Membres : relies a ce dont ils s'occupent (tous affiches a la racine)
    const memberNode = (m) =>
      add('m' + m.id, { type: 'member', id: m.id, depth: 2, title: m.pseudo, color: m.color, core: m.color, r: 9, online: s.online.includes(m.id) }, center);
    if (focus == null) for (const m of s.members) memberNode(m);
    for (const n of [...g.nodes]) {
      if (n.type !== 'node' || !n.assignee) continue;
      const m = member(n.assignee);
      if (!m) continue;
      edge(memberNode(m), n, 'member', 150);
    }
    if (focus == null) for (const n of g.nodes) if (n.type === 'member' && !g.edges.some((e) => e.a === n || e.b === n)) edge(center, n, 'member', 330);

    graph = g;
  }

  // --------------------------- Simulation 3D -------------------------------
  function simulate() {
    const N = graph.nodes;
    if (simAlpha < 0.004 || !N.length) return;
    const a = simAlpha;
    for (let i = 0; i < N.length; i++) {
      const p = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const q = N[j];
        let dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dz = Math.random() - 0.5; d2 = 1; }
        if (d2 > 640000) continue;
        const f = (9000 * a) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        p.vx += fx; p.vy += fy; p.vz += fz;
        q.vx -= fx; q.vy -= fy; q.vz -= fz;
      }
    }
    for (const e of graph.edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, dz = e.b.z - e.a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const k = e.type === 'tree' ? 0.05 : 0.02;
      const f = (d - e.len) * k * a;
      const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
      e.a.vx += fx; e.a.vy += fy; e.a.vz += fz;
      e.b.vx -= fx; e.b.vy -= fy; e.b.vz -= fz;
    }
    for (const p of N) {
      if (p.pinned) { p.x = p.y = p.z = p.vx = p.vy = p.vz = 0; continue; }
      p.vx -= p.x * 0.003 * a; p.vy -= p.y * 0.003 * a; p.vz -= p.z * 0.003 * a;
      p.vx *= 0.8; p.vy *= 0.8; p.vz *= 0.8;
      const v = Math.hypot(p.vx, p.vy, p.vz);
      if (v > 40) { p.vx *= 40 / v; p.vy *= 40 / v; p.vz *= 40 / v; }
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
    }
    simAlpha *= 0.988;
  }

  // Pre-calcule la disposition d'un coup (independant du nombre d'images/s)
  function settle(iterations = 160) {
    simAlpha = 1;
    for (let i = 0; i < iterations && simAlpha >= 0.004; i++) simulate();
  }

  // ------------------------------ Camera -----------------------------------
  let W = 0, H = 0, F = 800, dpr = 1;
  function resize() {
    const r = el.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    F = Math.min(W, H) * 1.15;
  }

  function project(x, y, z, translate = true) {
    if (translate) { x = x * bloom - cam.tx; y = y * bloom - cam.ty; z = z * bloom - cam.tz; }
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const depth = z2 + cam.dist;
    if (depth < 30) return null;
    const s = F / depth;
    const cx = panelOpen && W > 900 ? (W - 360) / 2 : W / 2;
    return { x: cx + x1 * s, y: H / 2 + y2 * s, s, depth };
  }

  function fitDistance() {
    let R = 120;
    for (const n of graph.nodes) R = Math.max(R, Math.hypot(n.x, n.y, n.z) + 40);
    const usable = Math.min(panelOpen && W > 900 ? W - 360 : W, H) * 0.44;
    return clamp((R * F) / usable, 420, 3200);
  }

  // ------------------------------- Rendu -----------------------------------
  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Etoiles du fond
    for (const st of stars) {
      const p = project(st.x, st.y, st.z, false);
      if (!p) continue;
      const tw = 0.55 + 0.45 * Math.sin(t * 0.0015 + st.tw);
      ctx.fillStyle = `rgba(200, 210, 255, ${0.5 * tw})`;
      ctx.fillRect(p.x, p.y, st.size, st.size);
    }

    for (const n of graph.nodes) n.p = project(n.x, n.y, n.z);
    const fog = (p) => (p ? clamp(1.35 - (p.depth - cam.dist * 0.55) / (cam.dist * 1.1), 0.12, 1) : 0);
    const active = hoverKey || panelHoverKey;
    const activeNode = active && graph.byKey.get(active);
    const near = new Set();
    if (activeNode) for (const e of graph.edges) if (e.a === activeNode || e.b === activeNode) near.add(e.a.key).add(e.b.key);

    // Liens
    ctx.lineCap = 'round';
    for (const e of graph.edges) {
      const pa = e.a.p, pb = e.b.p;
      if (!pa || !pb) continue;
      const hl = activeNode && (e.a === activeNode || e.b === activeNode);
      let al = Math.min(fog(pa), fog(pb)) * fade * (activeNode && !hl ? 0.35 : 1);
      if (e.type === 'link') {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = rgba('#fbbf24', (hl ? 0.9 : 0.42) * al);
        ctx.lineWidth = hl ? 1.8 : 1.1;
      } else if (e.type === 'member') {
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = rgba(e.a.type === 'member' ? e.a.color : e.b.color, (hl ? 0.9 : 0.4) * al);
        ctx.lineWidth = hl ? 1.6 : 1;
      } else {
        ctx.setLineDash([]);
        const col = e.b.done ? DONE : e.b.ghost ? '#94a3b8' : '#c7d2fe';
        ctx.strokeStyle = rgba(col, (hl ? 0.85 : e.a.depth === 0 ? 0.42 : 0.26) * al);
        ctx.lineWidth = (hl ? 2 : e.a.depth === 0 ? 1.5 : 1) * clamp(pa.s, 0.6, 1.6);
      }
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();

      // Petites lueurs qui voyagent du centre vers les besoins
      if (e.type === 'tree' && e.a.depth === 0 && !prefersReducedMotion()) {
        const k = ((t * 0.00035 + (e.b.id || 0) * 0.137) % 1 + 1) % 1;
        const x = pa.x + (pb.x - pa.x) * k, y = pa.y + (pb.y - pa.y) * k;
        ctx.fillStyle = rgba(e.b.done ? DONE : '#e0e7ff', 0.75 * al * Math.sin(k * Math.PI));
        ctx.beginPath();
        ctx.arc(x, y, 1.8 * clamp(pa.s, 0.6, 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // Noeuds, du plus lointain au plus proche
    const order = graph.nodes.filter((n) => n.p).sort((a, b) => b.p.depth - a.p.depth);
    for (const n of order) {
      const p = n.p;
      const dim = activeNode && n !== activeNode && !near.has(n.key);
      const al = fog(p) * fade * (dim ? 0.3 : 1) * (n.ghost ? 0.55 : 1);
      const r = n.r * p.s;
      const col = n.done ? DONE : n.color;
      const isActive = n === activeNode;

      // halo
      const halo = r * (n.type === 'root' ? 4 : 3);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo);
      g.addColorStop(0, rgba(col, (isActive ? 0.7 : 0.45) * al));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
      ctx.fill();

      // coeur
      ctx.globalAlpha = al;
      if (n.kind === 'contrainte') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = n.done ? DONE : '#f87171';
        ctx.fillRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
        ctx.restore();
      } else if (n.type === 'member') {
        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.online) {
          ctx.fillStyle = DONE;
          ctx.beginPath();
          ctx.arc(p.x + r * 0.75, p.y + r * 0.75, Math.max(2, r * 0.32), 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = n.done ? '#d1fae5' : n.core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.strokeStyle = col;
        ctx.stroke();
        if (n.type === 'root' || (n.depth === 0 && n.inside)) {
          // anneau de progression autour du centre
          const pct = n.inside ? n.insideDone / n.inside : 0;
          ctx.lineWidth = Math.max(2, r * 0.14);
          ctx.strokeStyle = rgba('#ffffff', 0.15);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.45, 0, Math.PI * 2);
          ctx.stroke();
          if (pct > 0) {
            ctx.strokeStyle = DONE;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 1.45, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
            ctx.stroke();
          }
        } else if (n.inside > 0 && n.depth >= 1) {
          // petits points : il y a encore des choses "dedans"
          ctx.fillStyle = rgba(col, 0.9);
          const dots = Math.min(n.inside, 5);
          for (let i = 0; i < dots; i++) {
            const a = -Math.PI / 2 + (i / dots) * Math.PI * 2 + t * 0.0006;
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(a) * r * 1.6, p.y + Math.sin(a) * r * 1.6, Math.max(1, r * 0.16), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (n.done && r > 5) {
          ctx.strokeStyle = '#047857';
          ctx.lineWidth = Math.max(1.4, r * 0.18);
          ctx.beginPath();
          ctx.moveTo(p.x - r * 0.42, p.y + r * 0.02);
          ctx.lineTo(p.x - r * 0.1, p.y + r * 0.34);
          ctx.lineTo(p.x + r * 0.45, p.y - r * 0.3);
          ctx.stroke();
        }
      }
      if (isActive) {
        ctx.strokeStyle = rgba('#ffffff', 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // etiquette
      const labelAlpha = al * (n.depth >= 2 && !isActive && p.s < 0.9 ? clamp((p.s - 0.45) * 2.2, 0, 1) : 1);
      if (labelAlpha < 0.06) continue;
      const size = (n.type === 'root' || n.depth === 0 ? 17 : n.depth === 1 ? 13.5 : 11.5) * clamp(p.s, 0.75, 1.35);
      ctx.font = `${n.depth <= 1 || n.type === 'member' ? 650 : 550} ${size}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
      const label = truncate(n.title, n.depth === 0 ? 40 : 34);
      let lx, ly;
      if (n.depth === 0) {
        ctx.textAlign = 'center';
        lx = p.x;
        ly = p.y + r * 1.45 + size + 6;
      } else {
        ctx.textAlign = 'left';
        lx = p.x + r + 7;
        ly = p.y + size * 0.36;
      }
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = `rgba(6, 9, 24, ${0.85 * labelAlpha})`;
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle =
        n.type === 'member' ? rgba(n.color, labelAlpha)
        : n.kind === 'contrainte' ? rgba('#fca5a5', labelAlpha)
        : n.done ? rgba('#a7f3d0', labelAlpha)
        : rgba(n.depth <= 1 ? '#ffffff' : '#cbd5e1', labelAlpha);
      ctx.fillText(label, lx, ly);
    }
  }

  // --------------------------- Boucle principale ---------------------------
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, t - (lastT || t));
    lastT = t;
    simulate();
    if (graph.nodes.length > 1) simulate();
    // auto-rotation douce quand on ne touche a rien
    if (!drag && !hoverKey && !busy && t - lastInteract > 2500 && !prefersReducedMotion()) cam.yaw += 0.00012 * dt;
    if (!busy) {
      cam.autoDist += (fitDistance() - cam.autoDist) * (1 - Math.exp(-dt / 350));
      cam.dist = cam.autoDist * cam.zoom;
    }
    draw(t);
  }

  function start() {
    if (!raf) {
      lastT = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function tween(dur, fn) {
    if (prefersReducedMotion()) dur = 1;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        fn(ease(k), k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // --------------------------- Interactions ---------------------------------
  let drag = null;
  const pointers = new Map();

  function hit(x, y) {
    let best = null, bestD = Infinity;
    for (const n of graph.nodes) {
      if (!n.p) continue;
      const r = Math.max(n.r * n.p.s, 7) + 5;
      const d = Math.hypot(n.p.x - x, n.p.y - y);
      if (d < r && n.p.depth < bestD) { best = n; bestD = n.p.depth; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (busy) return;
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    canvas.setPointerCapture(e.pointerId);
    lastInteract = performance.now();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, moved: true };
      return;
    }
    drag = { x: e.offsetX, y: e.offsetY, yaw: cam.yaw, pitch: cam.pitch, moved: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    lastInteract = performance.now();
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (drag?.pinch) {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      cam.zoom = clamp((drag.zoom * drag.pinch) / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 0.35, 3);
      return;
    }
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        el.classList.add('rotating');
        setHover(null);
      }
      if (drag.moved) {
        cam.yaw = drag.yaw + dx * 0.006;
        cam.pitch = clamp(drag.pitch + dy * 0.006, -1.3, 1.3);
      }
      return;
    }
    const n = hit(e.offsetX, e.offsetY);
    setHover(n ? n.key : null, e.offsetX, e.offsetY);
  });

  const up = (e) => {
    pointers.delete(e.pointerId);
    const d = drag;
    if (pointers.size === 0) drag = null;
    el.classList.remove('rotating');
    if (!d || d.moved || d.pinch || e.type !== 'pointerup') return;
    const n = hit(e.offsetX, e.offsetY);
    if (!n) return;
    if (n.type === 'member') return;
    if (n.type === 'root') return;
    if (n.depth === 0) return setPanel(true);
    navigate(`/carte/${mapId}/besoins/${n.id}`);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => !drag && setHover(null));
  canvas.addEventListener('dblclick', (e) => {
    if (!hit(e.offsetX, e.offsetY)) addNode();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      lastInteract = performance.now();
      cam.zoom = clamp(cam.zoom * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), 0.35, 3);
    },
    { passive: false }
  );

  function setHover(key, x, y) {
    if (key === hoverKey && !key) return;
    hoverKey = key;
    canvas.style.cursor = key ? 'pointer' : '';
    const n = key && graph.byKey.get(key);
    if (!n) return tip.classList.remove('show');
    const kinds = n.type === 'root' ? 'Projet' : n.type === 'member' ? 'Membre' : (KINDS[n.kind] || KINDS.besoin).label;
    const resp = n.assignee && member(n.assignee);
    const owned = n.type === 'member' ? S().nodes.filter((x) => x.assignee_id === n.id) : [];
    mount(
      tip,
      h('small', { class: 'k-' + (n.kind || n.type) }, kinds, n.done ? ' · ✓ validé' : ''),
      h('b', n.title),
      n.type === 'node' && n.inside > 0 && h('span', `${n.insideDone}/${n.inside} en place à l’intérieur`),
      resp && h('span', 'Responsable : ', resp.pseudo),
      n.type === 'member' && h('span', owned.length ? `S’occupe de ${owned.length} élément${owned.length > 1 ? 's' : ''}` : 'Aucun élément assigné'),
      n.type === 'node' && n.depth > 0 && h('em', 'Clique pour plonger dedans')
    );
    tip.style.left = x + 16 + 'px';
    tip.style.top = y + 16 + 'px';
    tip.classList.add('show');
  }

  const onKey = (e) => {
    if (!visible || hasOpenModal() || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape' && focus != null) {
      e.preventDefault();
      goUp();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      addNode();
    }
  };
  document.addEventListener('keydown', onKey);
  const onResize = debounce(() => visible && resize(), 80);
  window.addEventListener('resize', onResize);

  function goUp() {
    const f = focus != null && nodeById(focus);
    navigate(f?.parent_id ? `/carte/${mapId}/besoins/${f.parent_id}` : `/carte/${mapId}/besoins`);
  }

  // ------------------------- Transitions de focus ---------------------------
  async function changeFocus(next) {
    if (next === focus) return;
    busy = true;
    setHover(null);
    const target = next != null && graph.byKey.get('n' + next);
    const goingIn = !!target;
    const from = { tx: cam.tx, ty: cam.ty, tz: cam.tz, dist: cam.dist };
    // 1. on plonge vers l'etoile cliquee (ou on recule si on remonte)
    await tween(520, (k) => {
      if (goingIn) {
        cam.tx = from.tx + (target.x - from.tx) * k;
        cam.ty = from.ty + (target.y - from.ty) * k;
        cam.tz = from.tz + (target.z - from.tz) * k;
        cam.dist = from.dist * (1 - 0.8 * k);
      } else cam.dist = from.dist * (1 + 1.4 * k);
      fade = 1 - k;
    });
    // 2. nouvelle toile qui eclot depuis le centre
    focus = next;
    posCache.clear();
    buildGraph();
    settle();
    cam.tx = cam.ty = cam.tz = 0;
    cam.autoDist = fitDistance();
    renderChrome();
    const d0 = goingIn ? cam.autoDist * 0.35 : cam.autoDist * 2.2;
    bloom = 0.05;
    await tween(850, (k) => {
      bloom = 0.05 + 0.95 * k;
      cam.dist = d0 + (cam.autoDist * cam.zoom - d0) * k;
      fade = k;
    });
    bloom = 1;
    busy = false;
  }

  // ------------------------------ Panneau ----------------------------------
  function setPanel(open) {
    panelOpen = open;
    el.classList.toggle('panel-open', open);
    panelToggle.replaceChildren(icon(open ? 'x' : 'text', 18));
    panelToggle.setAttribute('aria-label', open ? 'Masquer le panneau' : 'Afficher le panneau');
  }

  function renderChrome() {
    focusPath = focus != null ? ancestors(focus).map((n) => n.id) : [];
    renderCrumbs();
    renderCounter();
    renderPanel();
    empty.hidden = S().nodes.length > 0 || focus != null;
  }

  function renderCrumbs() {
    const path = focus != null ? ancestors(focus) : [];
    mount(
      crumbs,
      h('button.crumb', { onclick: () => navigate(`/carte/${mapId}/besoins`), class: path.length ? '' : 'current' }, icon('sparkles', 14), S().map.name),
      path.map((n, i) => [
        h('span.crumb-sep', '›'),
        h('button.crumb', { class: i === path.length - 1 ? 'current' : '', onclick: () => navigate(`/carte/${mapId}/besoins/${n.id}`) }, truncate(n.title, 28)),
      ])
    );
  }

  function renderCounter() {
    const needs = S().nodes.filter((n) => n.kind === 'besoin');
    const done = needs.filter((n) => n.done).length;
    mount(counter, h('b', `${done}/${needs.length}`), ' besoins validés');
  }

  function renderPanel() {
    const ae = document.activeElement;
    const quickFocused = !!ae?.classList?.contains('wp-quick-input');
    if (!quickFocused && panel.contains(ae) && ae.matches('input, textarea, select')) {
      pendingPanel = true;
      return;
    }
    pendingPanel = false;
    if (quickFocused) queueMicrotask(() => panelBody.querySelector('.wp-quick-input')?.focus());
    const s = S();
    const kids = childrenMap();
    const f = focus != null ? nodeById(focus) : null;
    const list = kids.get(focus ?? 0) || [];
    const listTitle = f ? (f.kind === 'besoin' ? 'Ce qu’il faut pour ce besoin' : 'Éléments rattachés') : 'Besoins du projet';

    const item = (n) => {
      const k = KINDS[n.kind] || KINDS.besoin;
      const pr = progressOf(n.id, kids);
      const resp = n.assignee_id && member(n.assignee_id);
      const row = h(
        'div.wp-item',
        {
          class: n.done ? 'done' : '',
          onmouseenter: () => (panelHoverKey = 'n' + n.id),
          onmouseleave: () => (panelHoverKey = null),
        },
        h('button.wp-check', { 'aria-label': n.done ? 'Marquer non validé' : 'Valider', onclick: (e) => { e.stopPropagation(); patch(n.id, { done: !n.done }); } }, icon('check', 12)),
        h(
          'button.wp-item-main',
          { onclick: () => navigate(`/carte/${mapId}/besoins/${n.id}`) },
          h('i.kdot', { class: 'k-' + n.kind, style: { '--c': k.color } }),
          h('span.wp-item-title', n.title),
          pr.total > 0 && h('small', `${pr.done}/${pr.total}`)
        ),
        resp && avatar(resp, { size: 22 })
      );
      return row;
    };

    const kindSelect = (value) =>
      h('select.input.input-sm', Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: k === value }, v.label)));

    // Ajout rapide
    const quickInput = h('input.input.input-sm.wp-quick-input', { placeholder: f ? 'Ajouter ce qu’il faut…' : 'Ajouter un besoin…', maxLength: 120 });
    const quickKind = kindSelect(f ? 'solution' : 'besoin');
    const quick = h(
      'form.wp-quick',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          const title = quickInput.value.trim();
          if (!title) return quickInput.focus();
          try {
            const r = await api.post(`/api/maps/${mapId}/nodes`, { title, kind: quickKind.value, parent_id: focus });
            quickInput.value = '';
            applyState(r.state);
            quickInput.focus();
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
      quickInput,
      quickKind,
      h('button.btn.btn-primary.btn-sm', { type: 'submit', 'aria-label': 'Ajouter' }, icon('plus', 15))
    );

    if (!f) {
      const needs = s.nodes.filter((n) => n.kind === 'besoin');
      const done = needs.filter((n) => n.done).length;
      mount(
        panelBody,
        h('div.wp-head', h('span.wp-kind', icon('sparkles', 13), 'Projet'), h('h2', s.map.name), h('p.wp-sub', `${s.nodes.length} élément${s.nodes.length > 1 ? 's' : ''} dans la toile · ${s.links.length} lien${s.links.length > 1 ? 's' : ''} transverse${s.links.length > 1 ? 's' : ''}`)),
        h('div.wp-progress', h('div.bar', h('i', { style: { width: (needs.length ? (done / needs.length) * 100 : 0) + '%' } })), h('span', `${done}/${needs.length} validés`)),
        h('h4', listTitle),
        h('div.wp-list', list.length ? list.map(item) : h('p.wp-empty', 'Aucun besoin pour l’instant.')),
        quick
      );
      return;
    }

    const k = KINDS[f.kind] || KINDS.besoin;
    const pr = progressOf(f.id, kids);
    const desc = h('textarea.input.wp-desc', { rows: 3, placeholder: 'Détails, pourquoi, comment…', maxLength: 4000 });
    desc.value = f.description || '';
    desc.addEventListener('change', () => patch(f.id, { description: desc.value }));

    const resp = h(
      'select.input.input-sm',
      { onchange: (e) => patch(f.id, { assignee_id: e.target.value ? Number(e.target.value) : null }) },
      h('option', { value: '' }, 'Personne'),
      s.members.map((m) => h('option', { value: m.id, selected: m.id === f.assignee_id }, m.pseudo + (m.id === store.user.id ? ' (toi)' : '')))
    );
    const kindSel = kindSelect(f.kind);
    kindSel.addEventListener('change', () => patch(f.id, { kind: kindSel.value }));

    // Liens transverses
    const myLinks = s.links.filter((l) => l.source_id === f.id || l.target_id === f.id);
    const linkedIds = new Set(myLinks.map((l) => (l.source_id === f.id ? l.target_id : l.source_id)));
    const candidates = s.nodes.filter((n) => n.id !== f.id && !linkedIds.has(n.id));
    const linkSel = h(
      'select.input.input-sm',
      h('option', { value: '' }, 'Relier à un autre élément…'),
      candidates.map((n) => h('option', { value: n.id }, `${(KINDS[n.kind] || KINDS.besoin).label} · ${truncate(n.title, 40)}`))
    );
    linkSel.addEventListener('change', async () => {
      if (!linkSel.value) return;
      try {
        applyState((await api.post(`/api/maps/${mapId}/links`, { source_id: f.id, target_id: Number(linkSel.value) })).state);
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    // Deplacer sous un autre parent (hors de sa propre branche)
    const banned = new Set([f.id]);
    const stack = [...(kids.get(f.id) || [])];
    while (stack.length) {
      const n = stack.pop();
      banned.add(n.id);
      stack.push(...(kids.get(n.id) || []));
    }
    const parentSel = h(
      'select.input.input-sm',
      { onchange: (e) => patch(f.id, { parent_id: e.target.value ? Number(e.target.value) : null }) },
      h('option', { value: '' }, `Racine du projet`),
      s.nodes.filter((n) => !banned.has(n.id)).map((n) => h('option', { value: n.id, selected: n.id === f.parent_id }, truncate(n.title, 44)))
    );

    mount(
      panelBody,
      h(
        'div.wp-head',
        h('span.wp-kind', { style: { '--c': k.color } }, h('i.kdot', { class: 'k-' + f.kind, style: { '--c': k.color } }), k.label),
        h('h2', h('button.wp-title', { onclick: () => rename(f), title: 'Renommer' }, f.title, icon('edit', 14))),
        h('p.wp-sub', pr.total ? `${pr.done}/${pr.total} éléments en place à l’intérieur` : 'Rien à l’intérieur pour l’instant')
      ),
      h(
        'label.switch.wp-switch',
        h('input', { type: 'checkbox', checked: f.done, onchange: (e) => patch(f.id, { done: e.target.checked }) }),
        h('span.switch-ui'),
        h('span', f.kind === 'besoin' ? 'Besoin validé' : f.kind === 'contrainte' ? 'Contrainte respectée' : 'En place')
      ),
      h('div.wp-grid', h('label.field', h('span.field-label', 'Type'), kindSel), h('label.field', h('span.field-label', 'Responsable'), resp)),
      h('label.field', h('span.field-label', 'Description'), desc),
      h('h4', listTitle),
      h('div.wp-list', list.length ? list.map(item) : h('p.wp-empty', 'Ajoute ce qu’il faut mettre en place pour ce besoin.')),
      quick,
      h('h4', 'Relié à'),
      h(
        'div.wp-list',
        myLinks.length
          ? myLinks.map((l) => {
              const o = nodeById(l.source_id === f.id ? l.target_id : l.source_id);
              if (!o) return null;
              const ok = KINDS[o.kind] || KINDS.besoin;
              return h(
                'div.wp-item',
                h('button.wp-item-main', { onclick: () => navigate(`/carte/${mapId}/besoins/${o.id}`) }, h('i.kdot', { class: 'k-' + o.kind, style: { '--c': ok.color } }), h('span.wp-item-title', o.title)),
                h('button.icon-btn.wp-unlink', { 'aria-label': 'Retirer le lien', title: 'Retirer le lien', onclick: () => unlink(l.id) }, icon('x', 14))
              );
            })
          : h('p.wp-empty', 'Aucun lien transverse.')
      ),
      candidates.length > 0 && linkSel,
      h('h4', 'Rangé dans'),
      parentSel,
      h('button.btn.btn-ghost.btn-sm.danger-text.wp-delete', { onclick: () => remove(f) }, icon('trash', 15), 'Supprimer cet élément')
    );
  }

  // ------------------------------- Actions ---------------------------------
  async function patch(nid, body) {
    try {
      applyState((await api.patch(`/api/nodes/${nid}`, body)).state);
    } catch (e) {
      toast(e.message, 'err');
      renderPanel();
    }
  }

  async function unlink(lid) {
    try {
      applyState((await api.del(`/api/links/${lid}`)).state);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function rename(n) {
    const r = await promptDialog({ title: 'Renommer', label: 'Titre', value: n.title, maxLength: 120, confirmLabel: 'Renommer' });
    if (r) patch(n.id, { title: r.value });
  }

  async function remove(n) {
    const c = descendantsCount(n.id);
    const ok = await confirmDialog({
      title: 'Supprimer cet élément ?',
      message: c ? `« ${n.title} » et les ${c} élément${c > 1 ? 's' : ''} qu’il contient seront supprimés pour tout le monde.` : `« ${n.title} » sera supprimé pour tout le monde.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.del(`/api/nodes/${n.id}`);
      deletedByMe = n.id;
      applyState(r.state);
      toast('Élément supprimé', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function addNode() {
    const f = focus != null ? nodeById(focus) : null;
    let kind = f ? 'solution' : 'besoin';
    const seg = h(
      'div.kind-picker',
      Object.entries(KINDS).map(([k, v]) =>
        h('button.kind-opt', { type: 'button', class: k === kind ? 'on' : '', dataset: { k }, style: { '--c': v.color }, onclick: (e) => {
          kind = k;
          for (const b of seg.children) b.classList.toggle('on', b.dataset.k === k);
        } }, h('i.kdot', { class: 'k-' + k, style: { '--c': v.color } }), v.label)
      )
    );
    promptDialog({
      title: f ? `Ajouter dans « ${truncate(f.title, 30)} »` : 'Ajouter un besoin',
      label: 'Titre',
      placeholder: f ? 'ex : Sauvegarde externalisée' : 'ex : Accès à distance sécurisé',
      maxLength: 120,
      confirmLabel: 'Ajouter',
      extra: { node: h('div.field', h('span.field-label', 'Type'), seg), value: () => kind },
    }).then(async (r) => {
      if (!r) return;
      try {
        applyState((await api.post(`/api/maps/${mapId}/nodes`, { title: r.value, kind: r.extra, parent_id: focus })).state);
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  }

  // ------------------------------- API publique -----------------------------
  function show(nid = null) {
    if (nid != null && !nodeById(nid)) {
      toast('Cet élément n’existe plus', 'info');
      navigate(`/carte/${mapId}/besoins`, { replace: true });
      return;
    }
    if (!visible) {
      visible = true;
      el.hidden = false;
      setPanel(panelOpen);
      resize();
      focus = nid;
      posCache.clear();
      buildGraph();
      settle();
      cam.zoom = 1;
      cam.tx = cam.ty = cam.tz = 0;
      cam.autoDist = fitDistance();
      cam.dist = cam.autoDist;
      fade = 0;
      bloom = 0.05;
      renderChrome();
      requestAnimationFrame(() => el.classList.add('in'));
      start();
      tween(1000, (k) => {
        fade = Math.min(1, k * 1.6);
        bloom = 0.05 + 0.95 * k;
      }).then(() => (bloom = 1));
    } else if (nid !== focus) {
      changeFocus(nid);
    }
  }

  function hide() {
    if (!visible) return;
    visible = false;
    el.classList.remove('in');
    setHover(null);
    stop();
    el.hidden = true;
  }

  function update() {
    if (!visible) return;
    if (focus != null && !nodeById(focus)) {
      // Le centre a ete supprime (par moi ou quelqu'un d'autre) : on remonte au parent encore present
      const back = [...focusPath].reverse().find((nid) => nid !== focus && nodeById(nid));
      if (deletedByMe !== focus) toast('Cet élément vient d’être supprimé', 'info');
      deletedByMe = null;
      navigate(back ? `/carte/${mapId}/besoins/${back}` : `/carte/${mapId}/besoins`, { replace: true });
      return;
    }
    buildGraph();
    simAlpha = 0.35;
    for (let i = 0; i < 40; i++) simulate();
    simAlpha = Math.max(simAlpha, 0.2);
    renderChrome();
  }

  return {
    show,
    hide,
    update,
    isVisible: () => visible,
    destroy() {
      stop();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      el.remove();
    },
  };
}
