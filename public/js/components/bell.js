// ---------------------------------------------------------------------------
//  Cloche de notifications : invitations à rejoindre une carte
// ---------------------------------------------------------------------------
import { h, icon, avatar, mount, toast, timeAgo } from '../ui.js';
import { api } from '../api.js';
import { on } from '../realtime.js';

export function createBell({ navigate }) {
  let invitations = [];
  let open = false;
  const handled = new Map(); // id -> 'accepted' | 'declined' (affichage transitoire)

  const badge = h('span.bell-badge', { 'aria-hidden': 'true' });
  const btn = h('button.icon-btn.bell-btn', { 'aria-label': 'Notifications', 'aria-haspopup': 'true' }, icon('bell', 20), badge);
  const list = h('div.bell-list');
  const panel = h(
    'div.bell-panel',
    { role: 'dialog', 'aria-label': 'Notifications' },
    h('div.bell-head', h('b', 'Notifications'), h('small', 'Invitations à rejoindre des cartes')),
    list
  );
  const el = h('div.bell', btn, panel);

  function renderBadge() {
    const n = invitations.length;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('on', n > 0);
    btn.setAttribute('aria-label', n ? `Notifications (${n} en attente)` : 'Notifications');
  }

  function renderList() {
    const items = [...invitations.map((i) => ({ ...i, state: 'pending' })), ...[...handled.values()]];
    if (!items.length) {
      return mount(
        list,
        h('div.bell-empty', h('div.bell-empty-icon', icon('bell', 22)), h('b', 'Tout est calme'), h('small', 'Les invitations à rejoindre une carte apparaîtront ici.'))
      );
    }
    mount(
      list,
      items.map((inv) =>
        h(
          `div.bell-item.${inv.state}`,
          avatar({ pseudo: inv.inviter, color: inv.inviter_color }, { size: 36 }),
          h(
            'div.bell-text',
            h('p', h('b', inv.inviter), ' t’invite à rejoindre ', h('b', `« ${inv.map_name} »`)),
            h('small', `${inv.members} membre${inv.members > 1 ? 's' : ''} · ${timeAgo(inv.created_at)}`),
            inv.state === 'pending'
              ? h(
                  'div.bell-actions',
                  h('button.btn.btn-primary.btn-sm', { onclick: () => respond(inv, 'accept') }, icon('check', 14), 'Accepter'),
                  h('button.btn.btn-ghost.btn-sm', { onclick: () => respond(inv, 'decline') }, 'Refuser')
                )
              : inv.state === 'accepted'
                ? h('div.bell-actions', h('span.pill.pill-ok', icon('check', 12), 'Rejoint'), h('button.btn.btn-link.btn-sm', { onclick: () => { close(); navigate(`/carte/${inv.map_id}`); } }, 'Ouvrir la carte', icon('arrow', 14)))
                : h('div.bell-actions', h('span.pill', 'Refusée'))
          )
        )
      )
    );
  }

  async function respond(inv, action) {
    try {
      await api.post(`/api/invitations/${inv.id}/${action}`);
      handled.set(inv.id, { ...inv, state: action === 'accept' ? 'accepted' : 'declined' });
      invitations = invitations.filter((i) => i.id !== inv.id);
      renderBadge();
      renderList();
      if (action === 'accept') toast(`Tu as rejoint « ${inv.map_name} »`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
      load();
    }
  }

  async function load() {
    try {
      const r = await api.get('/api/invitations');
      invitations = r.invitations;
      for (const id of handled.keys()) if (invitations.some((i) => i.id === id)) handled.delete(id);
      renderBadge();
      renderList();
    } catch {}
  }

  function toggle() {
    open ? close() : show();
  }
  function show() {
    open = true;
    el.classList.add('open');
    renderList();
  }
  function close() {
    open = false;
    el.classList.remove('open');
    // les invitations traitees disparaissent a la fermeture
    setTimeout(() => {
      if (!open) {
        handled.clear();
        renderList();
      }
    }, 250);
  }

  btn.addEventListener('click', toggle);
  const outside = (e) => open && !el.contains(e.target) && close();
  const esc = (e) => open && e.key === 'Escape' && close();
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', esc);

  const off = on('invite', (data) => {
    load();
    if (data && data.from) {
      btn.classList.remove('ring');
      void btn.offsetWidth;
      btn.classList.add('ring');
      toast(`${data.from} t’invite sur « ${data.mapName} »`, 'invite', { action: { label: 'Voir', onClick: show }, duration: 6000 });
    }
  });

  load();
  return {
    el,
    destroy() {
      off();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    },
  };
}
