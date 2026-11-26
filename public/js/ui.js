// ---------------------------------------------------------------------------
//  Utilitaires UI : hyperscript, icones, toasts, modales, menus, avatars
// ---------------------------------------------------------------------------

// h('div.classe#id', {attrs}, ...enfants)
export function h(selector, props, ...children) {
  const [tag, ...rest] = selector.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  for (const token of rest) {
    if (token[0] === '.') el.classList.add(token.slice(1));
    else el.id = token.slice(1);
  }
  if (props && (props.nodeType || typeof props !== 'object' || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className += ' ' + v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && !['list', 'form', 'type'].includes(k)) {
        try {
          el[k] = v;
        } catch {
          el.setAttribute(k, v);
        }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function mount(node, ...children) {
  node.replaceChildren();
  append(node, children);
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// -------------------------------- Icones ----------------------------------
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  userPlus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6',
  back: 'M19 12H5M12 19l-7-7 7-7',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  more: 'M12 12h.01M19 12h.01M5 12h.01',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6',
  zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22',
  text: 'M17 10H3M21 6H3M21 14H3M17 18H3',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-1.5a1.5 1.5 0 0 0-1.1 2.5A1.5 1.5 0 0 1 14.3 21 9.6 9.6 0 0 1 12 22zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  at: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 3v4M21 5h-4M5 17v4M7 19H3',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  door: 'M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01M13 4.6v16.8a.6.6 0 0 1-.8.6L5 20V5.6a1 1 0 0 1 .8-1L12.2 3.4a.6.6 0 0 1 .8.6z',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  crown: 'M2 18h20M3 7l5 5 4-7 4 7 5-5-2 11H5z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
};

export function icon(name, size = 18, extraClass = '') {
  const el = svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': name === 'more' || name === 'grip' ? 3.2 : 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: `icon ${extraClass}`.trim(),
      'aria-hidden': 'true',
    },
    svg('path', { d: ICONS[name] || ICONS.x })
  );
  return el;
}

// -------------------------------- Toasts ----------------------------------
export function toast(message, type = 'info', { action, duration = 3800 } = {}) {
  const zone = document.getElementById('toasts');
  const icons = { ok: 'check', err: 'x', info: 'sparkles', invite: 'bell' };
  const el = h(
    `div.toast.toast-${type}`,
    { role: 'status' },
    h('span.toast-icon', icon(icons[type] || 'sparkles', 16)),
    h('span.toast-msg', message),
    action && h('button.toast-action', { onclick: () => { action.onClick(); dismiss(); } }, action.label)
  );
  zone.append(el);
  let timer = setTimeout(dismiss, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => (timer = setTimeout(dismiss, 1500)));
  function dismiss() {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }
}

// -------------------------------- Modales ---------------------------------
const modalStack = [];
export const hasOpenModal = () => modalStack.length > 0;
export function closeAllModals() {
  for (const m of [...modalStack].reverse()) m.close();
}

export function modal({ title, subtitle, body, actions = [], width = 460, onClose, className = '' }) {
  const zone = document.getElementById('modals');
  const lastFocus = document.activeElement;
  const footer = actions.length
    ? h(
        'div.modal-foot',
        actions.map((a) =>
          a === 'spacer'
            ? h('div.grow')
            : h(
                'button.btn',
                {
                  class: (a.kind || 'ghost').split(' ').map((k, i) => (i === 0 ? 'btn-' + k : k)).join(' '),
                  type: a.submit ? 'submit' : 'button',
                  form: a.submit ? 'modal-form' : undefined,
                  onclick: a.submit ? undefined : () => a.onClick?.(api),
                },
                a.icon && icon(a.icon, 16),
                a.label
              )
        )
      )
    : null;

  const card = h(
    `div.modal-card${className ? '.' + className : ''}`,
    { role: 'dialog', 'aria-modal': 'true', style: { maxWidth: width + 'px' } },
    h(
      'div.modal-head',
      h('div', h('h2.modal-title', title), subtitle && h('p.modal-sub', subtitle)),
      h('button.icon-btn', { 'aria-label': 'Fermer', onclick: () => api.close() }, icon('x', 18))
    ),
    h('div.modal-body', body),
    footer
  );
  const backdrop = h('div.modal-backdrop', { onmousedown: (e) => e.target === backdrop && api.close() }, card);
  zone.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('in'));

  const onKey = (e) => {
    if (e.key === 'Escape' && modalStack[modalStack.length - 1] === api) {
      e.stopPropagation();
      api.close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  let closed = false;
  const api = {
    el: card,
    close() {
      if (closed) return;
      closed = true;
      modalStack.splice(modalStack.indexOf(api), 1);
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('in');
      backdrop.classList.add('out');
      setTimeout(() => backdrop.remove(), 220);
      lastFocus?.focus?.();
      onClose?.();
    },
  };
  modalStack.push(api);
  setTimeout(() => card.querySelector('[autofocus], input, textarea, select')?.focus(), 60);
  return api;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title,
      body: h('p.confirm-msg', message),
      width: 420,
      onClose: () => resolve(result),
      actions: [
        { label: 'Annuler', onClick: () => m.close() },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; m.close(); } },
      ],
    });
  });
}

// Petite modale de saisie (renvoie la valeur ou null)
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Valider', maxLength = 60, extra }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.input', { value, placeholder, maxLength, autofocus: true, required: true });
    const form = h(
      'form#modal-form',
      {
        onsubmit: (e) => {
          e.preventDefault();
          if (!input.value.trim()) return input.focus();
          result = { value: input.value.trim(), extra: extra?.value?.() };
          m.close();
        },
      },
      h('label.field', h('span.field-label', label), input),
      extra?.node
    );
    const m = modal({
      title,
      body: form,
      width: 440,
      onClose: () => resolve(result),
      actions: [{ label: 'Annuler', onClick: () => m.close() }, { label: confirmLabel, kind: 'primary', submit: true }],
    });
    setTimeout(() => input.select(), 80);
  });
}

// --------------------------- Menu contextuel -------------------------------
let openMenu = null;
export function closeMenu() {
  openMenu?.();
  openMenu = null;
}

export function menu(anchor, items, { align = 'right' } = {}) {
  closeMenu();
  const el = h(
    'div.menu',
    { role: 'menu' },
    items.filter(Boolean).map((it) =>
      it === 'sep'
        ? h('div.menu-sep')
        : it.node
          ? it.node
          : h(
              `button.menu-item${it.danger ? '.danger' : ''}`,
              { role: 'menuitem', onclick: (e) => { e.stopPropagation(); closeMenu(); it.onClick(); } },
              it.icon && icon(it.icon, 16),
              h('span', it.label)
            )
    )
  );
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + el.offsetHeight > innerHeight - 8) top = r.top - el.offsetHeight - 6;
  Object.assign(el.style, { left: left + 'px', top: top + 'px' });
  requestAnimationFrame(() => el.classList.add('in'));

  const outside = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const esc = (e) => e.key === 'Escape' && closeMenu();
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
  });
  openMenu = () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc);
    el.classList.remove('in');
    setTimeout(() => el.remove(), 150);
  };
  return el;
}

// ------------------------------- Avatars -----------------------------------
export const initials = (pseudo = '?') => pseudo.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';

export function avatar(user, { size = 32, online = false, title = true } = {}) {
  return h(
    'span.avatar',
    {
      title: title ? user?.pseudo : undefined,
      style: { '--c': user?.color || '#94a3b8', width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px' },
      class: online ? 'online' : '',
    },
    initials(user?.pseudo)
  );
}

export function avatarStack(users, { max = 4, size = 28, online = [] } = {}) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return h(
    'span.avatar-stack',
    shown.map((u) => avatar(u, { size, online: online.includes(u.id) })),
    rest > 0 && h('span.avatar.more', { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.36) + 'px' } }, '+' + rest)
  );
}

// ------------------------------- Divers ------------------------------------
export function parseDate(s) {
  if (!s) return null;
  return new Date(String(s).replace(' ', 'T') + (s.length > 10 ? 'Z' : 'T00:00:00'));
}

export function timeAgo(s) {
  const d = parseDate(s);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return "à l'instant";
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `il y a ${hr} h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `il y a ${day} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDue(s) {
  const d = parseDate(s);
  if (!d) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400e3);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function isOverdue(s) {
  const d = parseDate(s);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#0ea5e9', '#64748b'];

export function colorPicker(value, onChange) {
  let current = value;
  const wrap = h('div.swatches', { role: 'radiogroup' });
  const render = () =>
    mount(
      wrap,
      PALETTE.map((c) =>
        h(
          'button.swatch',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(c === current),
            'aria-label': c,
            style: { '--c': c },
            class: c === current ? 'on' : '',
            onclick: () => {
              current = c;
              render();
              onChange?.(c);
            },
          },
          c === current && icon('check', 14)
        )
      )
    );
  render();
  return { node: wrap, value: () => current };
}

// Petite explosion de confettis (celebration quand un dossier est termine)
export function confetti(x, y, colors = PALETTE) {
  if (prefersReducedMotion()) return;
  for (let i = 0; i < 28; i++) {
    const p = h('i.confetti', { style: { left: x + 'px', top: y + 'px', background: colors[i % colors.length] } });
    document.body.append(p);
    const a = Math.random() * Math.PI * 2;
    const v = 80 + Math.random() * 140;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v - 60;
    p.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 120}px)) rotate(${Math.random() * 720}deg) scale(.6)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' }
    ).onfinish = () => p.remove();
  }
}
