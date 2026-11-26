// ---------------------------------------------------------------------------
//  Connexion / Inscription
// ---------------------------------------------------------------------------
import { api } from '../api.js';
import { h, mount, icon, svg, toast, debounce } from '../ui.js';

// Illustration : une mini carte mentale animee (noeud central + satellites)
function constellation() {
  const nodes = [
    { x: 300, y: 210, r: 46, main: true },
    { x: 120, y: 110, r: 26, c: '#f9a8d4' },
    { x: 480, y: 96, r: 30, c: '#a5b4fc' },
    { x: 520, y: 300, r: 24, c: '#6ee7b7' },
    { x: 150, y: 330, r: 30, c: '#fcd34d' },
    { x: 330, y: 380, r: 18, c: '#7dd3fc' },
  ];
  const s = svg('svg', { viewBox: '0 0 600 440', class: 'constellation', 'aria-hidden': 'true' });
  nodes.slice(1).forEach((n, i) => {
    const mx = (300 + n.x) / 2;
    s.append(svg('path', { d: `M300 210 C ${mx} 210, ${mx} ${n.y}, ${n.x} ${n.y}`, class: 'c-edge', style: `animation-delay:${0.2 + i * 0.15}s` }));
  });
  nodes.forEach((n, i) => {
    const g = svg('g', { class: 'c-node' + (n.main ? ' main' : ''), style: `animation-delay:${i * 0.12}s; --dur:${5 + (i % 3)}s` });
    g.append(svg('circle', { cx: n.x, cy: n.y, r: n.r, fill: n.main ? '#fff' : n.c }));
    if (!n.main) g.append(svg('circle', { cx: n.x, cy: n.y, r: n.r * 0.42, fill: '#fff', 'fill-opacity': '.85' }));
    else g.append(svg('circle', { cx: n.x, cy: n.y, r: 16, fill: '#8b5cf6' }));
    s.append(g);
  });
  return s;
}

export function mountAuth(root, { params, navigate, setUser }) {
  let mode = params.mode;

  const pseudo = h('input.input', { name: 'pseudo', autocomplete: 'username', placeholder: 'ton_pseudo', maxLength: 24, required: true, spellcheck: false, autocapitalize: 'off' });
  const password = h('input.input', { type: 'password', name: 'password', placeholder: '••••••••', required: true, minLength: 1 });
  const confirm = h('input.input', { type: 'password', name: 'confirm', autocomplete: 'new-password', placeholder: '••••••••' });
  const pseudoHint = h('small.field-hint.reg-only', 'Tes coéquipiers t’inviteront grâce à lui');
  const meter = h('div.pw-meter', h('i'), h('i'), h('i'), h('i'));
  const eye = h('button.input-addon', { type: 'button', 'aria-label': 'Afficher le mot de passe', tabIndex: -1 }, icon('eye', 17));
  eye.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eyeOff' : 'eye', 17));
  });

  const submit = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' });
  const pseudoField = h('label.field', h('span.field-label', 'Pseudo'), h('div.input-wrap', h('span.input-icon', icon('at', 17)), pseudo), pseudoHint);
  const meterField = h('div.reg-only', meter);
  const confirmField = h(
    'label.field.reg-only',
    h('span.field-label', 'Confirme le mot de passe'),
    h('div.input-wrap', h('span.input-icon', icon('lock', 17)), confirm),
    h('small.field-hint', 'Pas d’email = pas de récupération : note-le bien 😉')
  );

  const tabs = h(
    'div.seg',
    { role: 'tablist' },
    h('span.seg-thumb'),
    h('button.seg-btn', { type: 'button', dataset: { mode: 'login' }, onclick: () => setMode('login') }, 'Connexion'),
    h('button.seg-btn', { type: 'button', dataset: { mode: 'register' }, onclick: () => setMode('register') }, 'Inscription')
  );
  const title = h('h1.auth-title');
  const sub = h('p.auth-sub');

  const form = h(
    'form.auth-form',
    { onsubmit: onSubmit, novalidate: true },
    pseudoField,
    h('label.field', h('span.field-label', 'Mot de passe'), h('div.input-wrap', h('span.input-icon', icon('lock', 17)), password, eye)),
    meterField,
    confirmField,
    submit
  );

  function setMode(m, push = true) {
    mode = m;
    const reg = m === 'register';
    card.classList.toggle('is-register', reg);
    tabs.dataset.mode = m;
    for (const b of tabs.querySelectorAll('.seg-btn')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
    title.textContent = reg ? 'Crée ton compte' : 'Bon retour 👋';
    sub.textContent = reg ? 'Un pseudo, un mot de passe : c’est tout.' : 'Connecte-toi avec ton pseudo pour retrouver tes cartes.';
    submit.textContent = reg ? 'Créer mon compte' : 'Se connecter';
    password.autocomplete = reg ? 'new-password' : 'current-password';
    pseudo.autocomplete = reg ? 'nickname' : 'username';
    if (!reg) setHint('', 'Tes coéquipiers t’inviteront grâce à lui');
    else if (pseudo.value) checkPseudo();
    if (push) history.replaceState(null, '', reg ? '/inscription' : '/connexion');
  }

  // Force du mot de passe (indicatif)
  password.addEventListener('input', () => {
    const v = password.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    meter.dataset.score = v ? String(Math.max(1, score)) : '0';
  });

  // Disponibilite du pseudo en direct
  const checkPseudo = debounce(async () => {
    if (mode !== 'register') return;
    const v = pseudo.value.trim();
    if (!v) return setHint('', 'Tes coéquipiers t’inviteront grâce à lui');
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(v)) return setHint('bad', '3 à 24 caractères : lettres, chiffres, . _ -');
    const r = await api.get('/api/auth/pseudo-available?pseudo=' + encodeURIComponent(v)).catch(() => null);
    if (r && pseudo.value.trim() === v) setHint(r.available ? 'good' : 'bad', r.available ? 'Disponible ✓' : 'Ce pseudo est déjà pris');
  }, 280);
  const setHint = (cls, txt) => {
    pseudoHint.className = 'field-hint ' + cls;
    pseudoHint.textContent = txt;
  };
  pseudo.addEventListener('input', checkPseudo);

  async function onSubmit(e) {
    e.preventDefault();
    const reg = mode === 'register';
    if (!pseudo.value.trim()) return shake(pseudo, reg ? 'Choisis un pseudo' : 'Indique ton pseudo');
    if (!password.value) return shake(password, 'Indique ton mot de passe');
    if (reg && password.value.length < 8) return shake(password, 'Le mot de passe doit faire au moins 8 caractères');
    if (reg && confirm.value !== password.value) return shake(confirm, 'Les deux mots de passe ne correspondent pas');

    submit.disabled = true;
    submit.classList.add('loading');
    try {
      const body = { pseudo: pseudo.value.trim(), password: password.value };
      const { user } = await api.post(reg ? '/api/auth/register' : '/api/auth/login', body);
      setUser(user);
      card.classList.add('leaving');
      toast(reg ? `Bienvenue sur Orbit, ${user.pseudo} !` : `Content de te revoir, ${user.pseudo} !`, 'ok');
      setTimeout(() => navigate('/', { replace: true }), 260);
    } catch (err) {
      submit.disabled = false;
      submit.classList.remove('loading');
      shake(null, err.message);
      if (!reg) {
        password.value = '';
        password.focus();
      }
    }
  }

  function shake(input, msg) {
    toast(msg, 'err');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    input?.focus();
  }

  const card = h(
    'div.auth-card',
    h('a.brand.auth-brand-mobile', { href: '/connexion' }, h('img', { src: '/assets/logo.svg', alt: '', width: 30, height: 30 }), h('span', 'Orbit')),
    tabs,
    title,
    sub,
    form
  );

  const aside = h(
    'aside.auth-aside',
    h('div.auth-aside-brand', h('img', { src: '/assets/logo.svg', alt: '', width: 38, height: 38 }), h('span', 'Orbit')),
    h('div.auth-art', constellation()),
    h(
      'div.auth-pitch',
      h('h2', 'Votre projet de groupe, ', h('em', 'en un coup d’œil.')),
      h(
        'ul',
        h('li', icon('layers', 18), 'Une carte mentale par projet, des dossiers par thème'),
        h('li', icon('sparkles', 18), 'La toile des besoins en 3D : chaque besoin, tout ce qu’il faut pour lui'),
        h('li', icon('users', 18), 'Invite ton équipe par pseudo, tout le monde modifie en direct'),
        h('li', icon('check', 18), 'Les tâches de chacun, cochées au fur et à mesure')
      )
    )
  );

  mount(root, h('div.auth', aside, h('main.auth-main', card)));
  setMode(mode, false);
  setTimeout(() => pseudo.focus(), 50);

  return { onRoute: (p) => setMode(p.mode, false), destroy() {} };
}
