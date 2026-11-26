// ---------------------------------------------------------------------------
//  Barre du haut partagee : logo / contenu libre / cloche / menu utilisateur
// ---------------------------------------------------------------------------
import { h, icon, avatar, menu, modal, toast, colorPicker, debounce } from '../ui.js';
import { api } from '../api.js';
import { createBell } from './bell.js';

export function brand(navigate) {
  return h(
    'a.brand',
    { href: '/', 'data-link': '', 'aria-label': 'Orbit — accueil' },
    h('img', { src: '/assets/logo.svg', alt: '', width: 30, height: 30 }),
    h('span', 'Orbit')
  );
}

export function createTopbar({ store, navigate, logout, setUser, left, center, extra = [], onUserChange }) {
  const bell = createBell({ navigate });
  const me = h('button.user-btn', { 'aria-label': 'Mon compte' });
  const renderMe = () => me.replaceChildren(avatar(store.user, { size: 34, title: false }));
  renderMe();

  me.addEventListener('click', () => {
    menu(me, [
      {
        node: h(
          'div.menu-head',
          avatar(store.user, { size: 38, title: false }),
          h('div', h('b', store.user.pseudo), h('small', 'Membre depuis le ' + new Date(store.user.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR')))
        ),
      },
      'sep',
      { icon: 'settings', label: 'Mon profil', onClick: () => openProfile(store, (u) => { setUser(u); renderMe(); onUserChange?.(u); }) },
      { icon: 'logout', label: 'Se déconnecter', danger: true, onClick: logout },
    ]);
  });

  const el = h(
    'header.topbar',
    h('div.topbar-left', left || brand(navigate)),
    h('div.topbar-center', center),
    h('div.topbar-right', extra, bell.el, me)
  );
  return { el, destroy: () => bell.destroy(), refreshUser: renderMe };
}

// ------------------------------ Profil ------------------------------------
function openProfile(store, onSaved) {
  const u = store.user;
  const pseudo = h('input.input', { value: u.pseudo, maxLength: 24, autocomplete: 'nickname' });
  const pseudoHint = h('small.field-hint', '3 à 24 caractères : lettres, chiffres, . _ -');
  const colors = colorPicker(u.color);

  const check = debounce(async () => {
    const v = pseudo.value.trim();
    if (v.toLowerCase() === u.pseudo.toLowerCase()) return setHint('', '3 à 24 caractères : lettres, chiffres, . _ -');
    const r = await api.get('/api/auth/pseudo-available?pseudo=' + encodeURIComponent(v)).catch(() => null);
    if (!r) return;
    if (!r.valid) setHint('bad', 'Format invalide');
    else setHint(r.available ? 'good' : 'bad', r.available ? 'Disponible ✓' : 'Déjà pris');
  }, 300);
  const setHint = (cls, txt) => {
    pseudoHint.className = 'field-hint ' + cls;
    pseudoHint.textContent = txt;
  };
  pseudo.addEventListener('input', check);

  const current = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: 'Mot de passe actuel' });
  const next = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'Nouveau (8 caractères min.)' });

  const body = h(
    'form#modal-form.stack',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { user } = await api.patch('/api/auth/me', { pseudo: pseudo.value.trim(), color: colors.value() });
          if (next.value || current.value) {
            await api.post('/api/auth/password', { current: current.value, next: next.value });
            toast('Mot de passe modifié (autres appareils déconnectés)', 'ok');
          }
          onSaved(user);
          toast('Profil enregistré', 'ok');
          m.close();
        } catch (err) {
          toast(err.message, 'err');
        }
      },
    },
    h('div.profile-preview', avatar({ ...u }, { size: 56, title: false }), h('div', h('b', u.pseudo), h('small', 'Ton pseudo sert aussi à te connecter'))),
    h('label.field', h('span.field-label', 'Pseudo'), pseudo, pseudoHint),
    h('div.field', h('span.field-label', 'Couleur'), colors.node),
    h('details.pw-block', h('summary', icon('lock', 15), 'Changer de mot de passe'), h('div.stack', current, next))
  );

  // Apercu en direct de l'avatar
  const preview = body.querySelector('.profile-preview');
  const refreshPreview = () => preview.firstChild.replaceWith(avatar({ pseudo: pseudo.value || '?', color: colors.value() }, { size: 56, title: false }));
  pseudo.addEventListener('input', refreshPreview);
  body.addEventListener('click', (e) => e.target.closest('.swatch') && setTimeout(refreshPreview));

  const m = modal({
    title: 'Mon profil',
    body,
    actions: [{ label: 'Annuler', onClick: () => m.close() }, { label: 'Enregistrer', kind: 'primary', submit: true }],
  });
}
