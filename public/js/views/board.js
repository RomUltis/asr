// ---------------------------------------------------------------------------
//  Tableau d'un dossier (facon Trello) : une colonne par personne + "À répartir"
//  Ouverture : la carte du dossier se retourne en 3D et s'agrandit en plein ecran
//  pendant que la camera de la carte plonge vers elle.
// ---------------------------------------------------------------------------
import { api } from '../api.js';
import {
  h, mount, icon, svg, toast, menu, modal, avatar, confirmDialog, promptDialog, colorPicker,
  timeAgo, formatDue, isOverdue, hasOpenModal, prefersReducedMotion, confetti, closeMenu,
} from '../ui.js';

const EASE = 'cubic-bezier(.65,.05,.25,1)';
// Bascule nette d'une face a l'autre au passage des 90 degres. On ne se fie pas
// a backface-visibility : Chrome l'ignore quand un descendant est anime.
function faceSwap(front, back, at, D, opening) {
  const show = [{ opacity: 1 }, { opacity: 1, offset: at }, { opacity: 0, offset: Math.min(1, at + 0.001) }, { opacity: 0 }];
  const hide = show.map((k) => ({ ...k, opacity: 1 - k.opacity }));
  const o = { duration: D, easing: EASE, fill: 'forwards' };
  return [front.animate(opening ? show : hide, o), back.animate(opening ? hide : show, o)];
}
const closeMenuSafe = () => {
  try {
    closeMenu();
  } catch {}
};

export function createBoard(opts) {
  const { host, mapId, store, getState, applyState } = opts;
  let fid = null; // dossier affiche
  let layer = null;
  let parts = null; // elements du tableau monte
  let queue = Promise.resolve();
  let drag = null;
  let pendingRender = false;
  let hideDone = localStorage.getItem('orbit.hideDone') === '1';
  const cardEls = new Map();
  const colEls = new Map();

  const state = () => getState();
  const folder = () => state()?.folders.find((f) => f.id === fid);
  const tasks = () => state().tasks.filter((t) => t.folder_id === fid);
  const member = (id) => state().members.find((m) => m.id === id);

  // --------------------------- Ouverture / fermeture ---------------------------
  function open(id) {
    queue = queue.then(() => doOpen(id)).catch((e) => console.error(e));
    return queue;
  }
  function close() {
    queue = queue.then(() => doClose()).catch((e) => console.error(e));
    return queue;
  }

  function targetRect() {
    const m = innerWidth < 720 ? 0 : 18;
    return { left: m, top: m, width: innerWidth - m * 2, height: innerHeight - m * 2 };
  }

  async function doOpen(id) {
    if (fid === id && layer) return;
    if (layer) {
      // Déjà ouvert sur un autre dossier : on bascule sans animation de vol
      opts.setFolderHidden(fid, false);
      fid = id;
      opts.setFolderHidden(fid, true);
      cardEls.clear();
      colEls.clear();
      buildSheet();
      render(true);
      return;
    }
    const f = state()?.folders.find((x) => x.id === id);
    if (!f) return;
    fid = id;

    const reduced = prefersReducedMotion();
    const D = reduced ? 1 : 860;
    const from = opts.getFolderRect(id);
    const to = targetRect();

    // Face avant : copie de la carte du dossier ; face arriere : le tableau
    const front = h('div.face.face-front');
    const srcCard = opts.getFolderCard(id);
    if (srcCard) {
      const clone = srcCard.cloneNode(true);
      clone.classList.add('fcard-clone');
      clone.style.width = srcCard.offsetWidth + 'px';
      clone.style.transform = `scale(${from.width / srcCard.offsetWidth})`;
      front.append(clone);
    }
    const back = h('div.face.face-back');
    const backdrop = h('div.board-backdrop', { onclick: () => opts.requestClose() });
    const card3d = h('div.board-3d', { style: { '--c': f.color } }, front, back);
    layer = h('div.board-layer', backdrop, card3d);
    layer.parts = { backdrop, card3d, front, back };
    host.append(layer);
    buildSheet();
    render(true);

    opts.setFolderHidden(id, true);
    opts.onDive(id, true, D);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D * 0.9, easing: 'ease-out', fill: 'forwards' });
    front.firstChild?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: D * 0.42, fill: 'forwards' });

    // Le tableau est rendu a sa taille finale et mis a l'echelle pendant le vol
    const sheet = parts.sheet;
    Object.assign(sheet.style, { width: to.width + 'px', height: to.height + 'px' });
    sheet.animate([{ transform: `scale(${from.width / to.width}, ${from.height / to.height})` }, { transform: 'scale(1, 1)' }], { duration: D, easing: EASE });

    const rect = (r) => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const swaps = faceSwap(layer.parts.front, layer.parts.back, 0.5, D, true);
    const anim = card3d.animate(
      [
        { ...rect(from), transform: 'rotateY(0deg) rotateX(0deg) translateZ(0px)', borderRadius: '18px' },
        { transform: 'rotateY(-82deg) rotateX(9deg) translateZ(160px)', offset: 0.46 },
        { ...rect(to), transform: 'rotateY(-180deg) rotateX(0deg) translateZ(0px)', borderRadius: innerWidth < 720 ? '0px' : '26px' },
      ],
      { duration: D, easing: EASE, fill: 'forwards' }
    );
    await anim.finished.catch(() => {});
    if (fid !== id || !layer) return;
    card3d.classList.add('settled');
    anim.cancel();
    swaps.forEach((x) => x.cancel());
    Object.assign(sheet.style, { width: '', height: '' });
    layer.classList.add('open');
    if (pendingRender) {
      pendingRender = false;
      render();
    }
    document.addEventListener('keydown', onKey);
  }

  async function doClose() {
    if (!layer) return;
    const id = fid;
    const { backdrop, card3d, front, back } = layer.parts;
    const reduced = prefersReducedMotion();
    const D = reduced ? 1 : 720;
    document.removeEventListener('keydown', onKey);
    cancelDrag();

    layer.classList.remove('open');
    closeMenuSafe();

    // La carte se retourne et revient a sa place, le tableau retrecit avec elle
    const from = targetRect();
    const exists = !!state()?.folders.find((x) => x.id === id);
    const to = exists ? opts.getFolderRect(id) : { left: innerWidth / 2 - 100, top: innerHeight / 2 - 60, width: 200, height: 120 };
    card3d.classList.remove('settled');
    front.replaceChildren();
    const src = exists && opts.getFolderCard(id);
    if (src) {
      const clone = src.cloneNode(true);
      clone.classList.add('fcard-clone');
      clone.style.width = src.offsetWidth + 'px';
      clone.style.transform = `scale(${to.width / src.offsetWidth})`;
      front.append(clone);
      clone.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { duration: D, fill: 'forwards' });
    }
    const rect = (r) => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const sheet = parts.sheet;
    Object.assign(sheet.style, { width: from.width + 'px', height: from.height + 'px' });
    sheet.animate([{ transform: 'scale(1, 1)' }, { transform: `scale(${to.width / from.width}, ${to.height / from.height})` }], { duration: D, easing: EASE, fill: 'forwards' });
    opts.onDive(id, false, D);
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D, easing: 'ease-in', fill: 'forwards' });
    faceSwap(front, back, 0.49, D, false);
    const anim = card3d.animate(
      [
        { ...rect(from), transform: 'rotateY(-180deg) rotateX(0deg) translateZ(0px)', borderRadius: '26px', opacity: 1 },
        { transform: 'rotateY(-98deg) rotateX(9deg) translateZ(160px)', offset: 0.54 },
        { ...rect(to), transform: 'rotateY(0deg) rotateX(0deg) translateZ(0px)', borderRadius: '18px', opacity: exists ? 1 : 0 },
      ],
      { duration: D, easing: EASE, fill: 'forwards' }
    );
    await anim.finished.catch(() => {});
    opts.setFolderHidden(id, false);
    if (exists) opts.onLanded(id);
    layer.remove();
    layer = null;
    parts = null;
    fid = null;
    cardEls.clear();
    colEls.clear();
  }

  function onKey(e) {
    if (e.key === 'Escape' && !hasOpenModal() && !drag && !e.target.closest?.('textarea, input')) {
      e.preventDefault();
      opts.requestClose();
    }
  }

  // ------------------------------ Structure -----------------------------------
  function buildSheet() {
    const titleEl = h('h2.sheet-title');
    const subEl = h('p.sheet-sub');
    const ringFg = svg('circle', { cx: 22, cy: 22, r: 18, class: 'ring-fg', pathLength: 100 });
    const ringLabel = h('span.ring-label');
    const statsText = h('span.sheet-stats-text');
    const hideBtn = h('button.chip-toggle', { onclick: toggleHide, 'aria-pressed': String(hideDone) });
    const moreBtn = h('button.icon-btn', { 'aria-label': 'Options du dossier', onclick: () => sheetMenu(moreBtn) }, icon('more', 18));
    const cols = h('div.sheet-cols');
    const sheet = h(
      'div.sheet',
      h(
        'header.sheet-head',
        h('span.sheet-icon', icon('folder', 22)),
        h('div.sheet-titles', h('button.sheet-title-btn', { onclick: renameFolder, title: 'Renommer' }, titleEl), subEl),
        h('div.sheet-stats', h('div.ring', svg('svg', { viewBox: '0 0 44 44' }, svg('circle', { cx: 22, cy: 22, r: 18, class: 'ring-bg' }), ringFg), ringLabel), statsText),
        h('div.sheet-actions', hideBtn, moreBtn, h('button.icon-btn.close-btn', { 'aria-label': 'Fermer (Échap)', title: 'Fermer (Échap)', onclick: () => opts.requestClose() }, icon('x', 20)))
      ),
      cols
    );
    parts = { sheet, titleEl, subEl, ringFg, ringLabel, statsText, hideBtn, cols };
    layer.parts.back.replaceChildren(sheet);
    renderHideBtn();
  }

  function renderHideBtn() {
    parts.hideBtn.replaceChildren(icon(hideDone ? 'eyeOff' : 'eye', 15), hideDone ? 'Terminées masquées' : 'Masquer les terminées');
    parts.hideBtn.setAttribute('aria-pressed', String(hideDone));
    parts.hideBtn.classList.toggle('on', hideDone);
  }

  function toggleHide() {
    hideDone = !hideDone;
    localStorage.setItem('orbit.hideDone', hideDone ? '1' : '0');
    renderHideBtn();
    render();
  }

  // ------------------------------- Rendu --------------------------------------
  function update() {
    if (!fid || !layer) return;
    if (!folder()) {
      toast('Ce dossier vient d’être supprimé', 'info');
      opts.requestClose();
      return;
    }
    if (drag) {
      pendingRender = true;
      return;
    }
    if (layer.classList.contains('open')) render();
    else pendingRender = true; // en plein vol : on rendra a l'atterrissage
  }

  function columns() {
    const me = store.user.id;
    const members = [...state().members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
    return [{ key: 'none', uid: null, user: null }, ...members.map((m) => ({ key: 'u' + m.id, uid: m.id, user: m }))];
  }

  function sortTasks(list) {
    return [...list].sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position || a.id - b.id);
  }

  function render(entering = false) {
    if (!parts || !folder()) return;
    const f = folder();
    const all = tasks();
    const done = all.filter((t) => t.done).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const creator = member(f.created_by);
    layer.parts.card3d.style.setProperty('--c', f.color);
    parts.titleEl.textContent = f.title;
    parts.subEl.textContent = `${state().map.name}${creator ? ` · créé par ${creator.pseudo}` : ''}`;
    parts.ringFg.style.strokeDasharray = `${pct} 100`;
    parts.ringFg.style.opacity = pct ? '1' : '0';
    parts.ringLabel.textContent = all.length ? pct + '%' : '–';
    parts.statsText.replaceChildren(h('b', `${done}/${all.length}`), all.length ? ' terminées' : ' tâche');

    // FLIP : on memorise la position des cartes avant de re-rendre
    const before = new Map();
    if (!entering) for (const [id, el] of cardEls) if (el.isConnected) before.set(id, el.getBoundingClientRect());

    const cols = columns();
    const keep = new Set(cols.map((c) => c.key));
    for (const k of colEls.keys()) if (!keep.has(k)) colEls.delete(k);

    const colNodes = cols.map((c, ci) => {
      let rec = colEls.get(c.key);
      if (!rec) {
        rec = makeColumn(c);
        colEls.set(c.key, rec);
        if (entering) rec.el.style.animationDelay = 60 + ci * 70 + 'ms';
      }
      const list = sortTasks(all.filter((t) => (t.assignee_id ?? null) === c.uid));
      const visible = hideDone ? list.filter((t) => !t.done) : list;
      const cdone = list.filter((t) => t.done).length;

      // En-tete de colonne
      const isMe = c.uid === store.user.id;
      mount(
        rec.head,
        c.user ? avatar(c.user, { size: 30, online: state().online.includes(c.uid) }) : h('span.col-none-icon', icon('sparkles', 16)),
        h('div.col-name', h('b', c.user ? c.user.pseudo : 'À répartir', isMe && h('span.you', ' · toi')), h('small', c.user ? (list.length ? `${list.length - cdone} en cours` : 'Rien pour l’instant') : 'Tâches sans responsable')),
        h('span.col-count', list.length ? `${cdone}/${list.length}` : '0')
      );
      rec.bar.style.width = (list.length ? (cdone / list.length) * 100 : 0) + '%';
      rec.el.classList.toggle('mine', isMe);
      rec.el.style.setProperty('--uc', c.user?.color || '#94a3b8');

      const cardNodes = visible.map((t) => {
        let el = cardEls.get(t.id);
        if (!el) {
          el = h('article.tcard', { dataset: { id: t.id }, tabIndex: 0 });
          cardEls.set(t.id, el);
          if (!entering) el.classList.add('enter');
        }
        fillCard(el, t);
        return el;
      });
      const current = [...rec.list.querySelectorAll(':scope > .tcard')];
      if (current.length !== cardNodes.length || current.some((n, i) => n !== cardNodes[i])) {
        rec.list.replaceChildren(...cardNodes, rec.empty);
      }
      const hiddenCount = list.length - visible.length;
      rec.empty.textContent = hiddenCount ? `${hiddenCount} terminée${hiddenCount > 1 ? 's' : ''} masquée${hiddenCount > 1 ? 's' : ''}` : c.user ? 'Glisse une tâche ici' : 'Ajoute ce qu’il y a à faire';
      rec.empty.classList.toggle('muted', !!hiddenCount);
      return rec.el;
    });

    const existing = [...parts.cols.children];
    if (existing.length !== colNodes.length || existing.some((n, i) => n !== colNodes[i])) parts.cols.replaceChildren(...colNodes);
    if (entering) for (const n of colNodes) n.classList.add('col-enter');

    // Nettoyage des cartes disparues
    const ids = new Set(all.map((t) => t.id));
    for (const id of [...cardEls.keys()]) if (!ids.has(id)) cardEls.delete(id);

    // FLIP : animation des cartes qui ont bouge
    if (!prefersReducedMotion()) {
      for (const [id, r0] of before) {
        const el = cardEls.get(id);
        if (!el || !el.isConnected) continue;
        const r1 = el.getBoundingClientRect();
        const dx = r0.left - r1.left;
        const dy = r0.top - r1.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      }
    }
  }

  function makeColumn(c) {
    const head = h('header.col-head');
    const bar = h('i');
    const empty = h('div.col-empty');
    const list = h('div.col-list', { dataset: { uid: c.uid ?? '' } }, empty);
    const add = h('div.col-add');
    const el = h('section.col', { dataset: { key: c.key } }, head, h('div.col-bar', bar), list, add);
    renderAddButton(add, c.uid);
    list.addEventListener('pointerdown', onCardPointerDown);
    list.addEventListener('keydown', (e) => {
      const card = e.target.closest('.tcard');
      if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openTask(Number(card.dataset.id));
      }
    });
    return { el, head, bar, list, empty, add };
  }

  function fillCard(el, t) {
    el.classList.toggle('done', t.done);
    el.classList.toggle('overdue', !t.done && isOverdue(t.due_date));
    const check = h(
      'button.tcheck',
      {
        'aria-label': t.done ? 'Marquer comme non terminée' : 'Marquer comme terminée',
        onpointerdown: (e) => e.stopPropagation(),
        onclick: (e) => {
          e.stopPropagation();
          toggleDone(t, el, check);
        },
      },
      icon('check', 13)
    );
    const meta = [];
    if (t.due_date) meta.push(h('span.tchip.due', icon('calendar', 12), formatDue(t.due_date)));
    if (t.description) meta.push(h('span.tchip', icon('text', 12)));
    el.replaceChildren(
      check,
      h('div.tmain', h('p.ttitle', t.title), t.description && h('p.tdesc', t.description), meta.length > 0 && h('div.tmeta', meta))
    );
  }

  // --------------------------- Ajout rapide ------------------------------------
  function renderAddButton(add, uid) {
    mount(add, h('button.col-add-btn', { onclick: () => renderAddForm(add, uid) }, icon('plus', 16), 'Ajouter une tâche'));
  }

  function renderAddForm(add, uid) {
    const ta = h('textarea.input.add-input', { rows: 2, placeholder: 'Que faut-il faire ?', maxLength: 140 });
    const submit = async () => {
      const title = ta.value.trim();
      if (!title) return ta.focus();
      ta.disabled = true;
      try {
        const r = await api.post(`/api/folders/${fid}/tasks`, { title, assignee_id: uid });
        applyState(r.state);
        ta.value = '';
      } catch (e) {
        toast(e.message, 'err');
      }
      ta.disabled = false;
      ta.focus();
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        renderAddButton(add, uid);
      }
    });
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
    mount(
      add,
      h(
        'div.add-form',
        ta,
        h(
          'div.add-actions',
          h('button.btn.btn-primary.btn-sm', { onclick: submit }, 'Ajouter'),
          h('button.icon-btn', { 'aria-label': 'Annuler', onclick: () => renderAddButton(add, uid) }, icon('x', 16)),
          h('small', 'Entrée pour valider')
        )
      )
    );
    ta.focus();
    add.closest('.col')?.querySelector('.col-list')?.scrollTo({ top: 1e6, behavior: 'smooth' });
  }

  // ------------------------------ Actions --------------------------------------
  async function toggleDone(t, el, check) {
    const next = !t.done;
    const t0 = performance.now();
    const all = tasks();
    const wasComplete = all.length > 0 && all.every((x) => x.done);
    el.classList.toggle('done', next);
    if (next && !prefersReducedMotion()) {
      check.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 300 });
    }
    try {
      const r = await api.patch(`/api/tasks/${t.id}`, { done: next });
      // laisse le temps a l'animation de se jouer avant que la carte ne glisse
      const wait = next ? Math.max(0, 420 - (performance.now() - t0)) : 0;
      setTimeout(() => {
        applyState(r.state);
        const now = tasks();
        if (next && !wasComplete && now.length > 0 && now.every((x) => x.done)) {
          const b = check.getBoundingClientRect();
          confetti(b.left + b.width / 2, b.top + b.height / 2, [folder()?.color || '#6366f1', '#f59e0b', '#10b981', '#ec4899']);
          toast(`Dossier « ${folder()?.title} » terminé ! 🎉`, 'ok');
        }
      }, wait);
    } catch (e) {
      el.classList.toggle('done', !next);
      toast(e.message, 'err');
    }
  }

  function openTask(id) {
    const t = state().tasks.find((x) => x.id === id);
    if (!t) return;
    const title = h('input.input.input-lg', { value: t.title, maxLength: 140, required: true });
    const assignee = h(
      'select.input',
      h('option', { value: '' }, '— À répartir —'),
      state().members.map((m) => h('option', { value: m.id, selected: m.id === t.assignee_id }, m.pseudo + (m.id === store.user.id ? ' (toi)' : '')))
    );
    const due = h('input.input', { type: 'date', value: t.due_date || '' });
    const desc = h('textarea.input', { rows: 5, placeholder: 'Détails, liens, remarques…', maxLength: 4000 });
    desc.value = t.description || '';
    const doneBox = h('input', { type: 'checkbox', checked: t.done });
    const creator = member(t.created_by);

    const body = h(
      'form#modal-form.stack',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          if (!title.value.trim()) return title.focus();
          try {
            const r = await api.patch(`/api/tasks/${t.id}`, {
              title: title.value.trim(),
              assignee_id: assignee.value ? Number(assignee.value) : null,
              due_date: due.value || null,
              description: desc.value,
              done: doneBox.checked,
            });
            applyState(r.state);
            m.close();
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
      h('label.field', h('span.field-label', 'Titre'), title),
      h('div.row-2', h('label.field', h('span.field-label', 'Responsable'), assignee), h('label.field', h('span.field-label', 'Échéance'), due)),
      h('label.field', h('span.field-label', 'Description'), desc),
      h('label.switch', doneBox, h('span.switch-ui'), h('span', 'Tâche terminée')),
      h('small.task-meta', `Créée ${creator ? `par ${creator.pseudo} ` : ''}${timeAgo(t.created_at)}${t.done && t.done_at ? ` · terminée ${timeAgo(t.done_at)}` : ''}`)
    );
    const m = modal({
      title: 'Tâche',
      subtitle: folder()?.title,
      body,
      width: 520,
      actions: [
        {
          label: 'Supprimer',
          icon: 'trash',
          kind: 'ghost danger-text',
          onClick: async () => {
            const ok = await confirmDialog({ title: 'Supprimer la tâche ?', message: `« ${t.title} » sera supprimée pour tout le monde.`, confirmLabel: 'Supprimer', danger: true });
            if (!ok) return;
            try {
              applyState((await api.del(`/api/tasks/${t.id}`)).state);
              m.close();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        'spacer',
        { label: 'Annuler', onClick: () => m.close() },
        { label: 'Enregistrer', kind: 'primary', submit: true },
      ],
    });
  }

  function sheetMenu(anchor) {
    const f = folder();
    const picker = colorPicker(f.color, async (c) => {
      try {
        applyState((await api.patch(`/api/folders/${f.id}`, { color: c })).state);
      } catch (e) {
        toast(e.message, 'err');
      }
    });
    menu(anchor, [
      { icon: 'edit', label: 'Renommer le dossier', onClick: renameFolder },
      { node: h('div.menu-colors', h('small', 'Couleur'), picker.node) },
      'sep',
      { icon: 'trash', label: 'Supprimer le dossier', danger: true, onClick: deleteFolder },
    ]);
  }

  async function renameFolder() {
    const f = folder();
    const r = await promptDialog({ title: 'Renommer le dossier', label: 'Nom du dossier', value: f.title, confirmLabel: 'Renommer' });
    if (!r) return;
    try {
      applyState((await api.patch(`/api/folders/${f.id}`, { title: r.value })).state);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function deleteFolder() {
    const f = folder();
    const n = tasks().length;
    const ok = await confirmDialog({
      title: 'Supprimer le dossier ?',
      message: n ? `« ${f.title} » et ses ${n} tâche${n > 1 ? 's' : ''} seront supprimés pour tout le monde.` : `Le dossier « ${f.title} » sera supprimé.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.del(`/api/folders/${f.id}`);
      toast('Dossier supprimé', 'ok');
      await close();
      applyState(r.state);
      opts.requestClose();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  // ------------------------- Glisser-deposer -----------------------------------
  function onCardPointerDown(e) {
    const card = e.target.closest('.tcard');
    if (!card || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.tcheck')) return;
    const start = { x: e.clientX, y: e.clientY, id: Number(card.dataset.id), card, pointerId: e.pointerId, type: e.pointerType };
    let longPress = null;
    let armed = e.pointerType === 'mouse';
    if (!armed) longPress = setTimeout(() => { armed = true; navigator.vibrate?.(8); beginDrag(start, start.x, start.y); }, 260);

    const move = (ev) => {
      if (ev.pointerId !== start.pointerId) return;
      if (drag) {
        ev.preventDefault();
        moveDrag(ev.clientX, ev.clientY);
        return;
      }
      const dist = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
      if (!armed) {
        if (dist > 8) cleanup(); // defilement tactile : on laisse faire
        return;
      }
      if (dist > 6) beginDrag(start, ev.clientX, ev.clientY);
    };
    const up = (ev) => {
      if (ev.pointerId !== start.pointerId) return;
      const wasDragging = !!drag;
      cleanup();
      if (wasDragging) endDrag();
      else if (ev.type === 'pointerup' && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) openTask(start.id);
    };
    const cleanup = () => {
      clearTimeout(longPress);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function beginDrag(start, x, y) {
    if (drag) return;
    const card = start.card;
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('tghost');
    Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.append(ghost);
    card.classList.add('placeholder');
    drag = { id: start.id, card, ghost, offX: start.x - r.left, offY: start.y - r.top, x, y, scroll: 0, origin: { parent: card.parentElement, next: card.nextElementSibling } };
    document.body.classList.add('dragging-task');
    moveDrag(x, y);
    autoScroll();
  }

  function moveDrag(x, y) {
    drag.x = x;
    drag.y = y;
    drag.ghost.style.transform = `translate(${x - drag.offX - parseFloat(drag.ghost.style.left)}px, ${y - drag.offY - parseFloat(drag.ghost.style.top)}px) rotate(3deg)`;
    const under = document.elementFromPoint(x, y);
    const col = under?.closest('.col');
    if (!col || !parts?.cols.contains(col)) return;
    const list = col.querySelector('.col-list');
    for (const c of parts.cols.querySelectorAll('.col.drop')) if (c !== col) c.classList.remove('drop');
    col.classList.add('drop');
    const cards = [...list.querySelectorAll(':scope > .tcard:not(.placeholder)')];
    const before = cards.find((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    const ref = before || list.querySelector(':scope > .col-empty');
    if (drag.card.nextElementSibling !== ref || drag.card.parentElement !== list) list.insertBefore(drag.card, ref);
  }

  function autoScroll() {
    if (!drag) return;
    const cols = parts.cols;
    const r = cols.getBoundingClientRect();
    const edge = 70;
    if (drag.x < r.left + edge) cols.scrollLeft -= 14;
    else if (drag.x > r.right - edge) cols.scrollLeft += 14;
    const list = document.elementFromPoint(drag.x, drag.y)?.closest('.col')?.querySelector('.col-list');
    if (list) {
      const lr = list.getBoundingClientRect();
      if (drag.y < lr.top + 40) list.scrollTop -= 10;
      else if (drag.y > lr.bottom - 40) list.scrollTop += 10;
    }
    drag.scroll = requestAnimationFrame(autoScroll);
  }

  async function endDrag() {
    const d = drag;
    cancelAnimationFrame(d.scroll);
    document.body.classList.remove('dragging-task');
    for (const c of parts?.cols.querySelectorAll('.col.drop') || []) c.classList.remove('drop');
    const list = d.card.parentElement;
    const uid = list?.dataset.uid ? Number(list.dataset.uid) : null;
    const t = state().tasks.find((x) => x.id === d.id);

    // Atterrissage du fantome a sa nouvelle place
    const r = d.card.getBoundingClientRect();
    const land = d.ghost.animate(
      [{ transform: d.ghost.style.transform }, { transform: `translate(${r.left - parseFloat(d.ghost.style.left)}px, ${r.top - parseFloat(d.ghost.style.top)}px) rotate(0deg)` }],
      { duration: prefersReducedMotion() ? 1 : 180, easing: 'ease-out', fill: 'forwards' }
    );
    land.finished.then(() => {
      d.ghost.remove();
      d.card.classList.remove('placeholder');
    });

    drag = null;
    if (!t) return;
    const pos = (el) => state().tasks.find((x) => x.id === Number(el?.dataset?.id))?.position;
    const prev = d.card.previousElementSibling?.classList.contains('tcard') ? pos(d.card.previousElementSibling) : undefined;
    const next = d.card.nextElementSibling?.classList.contains('tcard') ? pos(d.card.nextElementSibling) : undefined;
    let position;
    if (prev !== undefined && next !== undefined) position = (prev + next) / 2;
    else if (prev !== undefined) position = prev + 1;
    else if (next !== undefined) position = next - 1;
    else position = t.position;

    const changed = uid !== (t.assignee_id ?? null) || position !== t.position;
    if (!changed) {
      if (pendingRender) { pendingRender = false; render(); }
      return;
    }
    // Mise a jour optimiste locale puis serveur
    t.assignee_id = uid;
    t.position = position;
    pendingRender = false;
    render();
    try {
      const res = await api.patch(`/api/tasks/${t.id}`, { assignee_id: uid, position });
      applyState(res.state);
      if (uid && uid !== store.user.id) {
        const m = member(uid);
        if (m) toast(`Tâche confiée à ${m.pseudo}`, 'ok', { duration: 2200 });
      }
    } catch (e) {
      toast(e.message, 'err');
      const r2 = await api.get(`/api/maps/${mapId}`).catch(() => null);
      if (r2) applyState(r2.state);
    }
  }

  function cancelDrag() {
    if (!drag) return;
    cancelAnimationFrame(drag.scroll);
    drag.ghost.remove();
    drag.card.classList.remove('placeholder');
    document.body.classList.remove('dragging-task');
    drag = null;
  }

  // Sur ecran tactile : empeche le defilement pendant qu'on deplace une carte
  const blockScroll = (e) => drag && e.cancelable && e.preventDefault();
  document.addEventListener('touchmove', blockScroll, { passive: false });

  return {
    open,
    close,
    update,
    isOpen: () => !!layer,
    folderId: () => fid,
    destroy() {
      cancelDrag();
      document.removeEventListener('touchmove', blockScroll);
      document.removeEventListener('keydown', onKey);
      layer?.remove();
      layer = null;
    },
  };
}
