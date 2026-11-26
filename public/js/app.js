// ===========================================================================
//  Orbit — application front (SPA modulaire, zero framework)
// ===========================================================================
import { api, setUnauthorizedHandler } from './api.js';
import { connectRealtime, disconnectRealtime } from './realtime.js';
import { closeMenu, closeAllModals } from './ui.js';
import { mountAuth } from './views/auth.js';
import { mountHome } from './views/home.js';
import { mountMap } from './views/map.js';

export const store = { user: null };

const root = document.getElementById('app');

// Routes : chemin -> vue. Une vue renvoie { destroy(), onRoute?(params) }
const ROUTES = [
  { re: /^\/connexion\/?$/, key: 'auth', view: mountAuth, public: true, params: () => ({ mode: 'login' }) },
  { re: /^\/inscription\/?$/, key: 'auth', view: mountAuth, public: true, params: () => ({ mode: 'register' }) },
  {
    re: /^\/carte\/(\d+)(?:\/(dossier|besoins)(?:\/(\d+))?)?\/?$/,
    key: 'map',
    view: mountMap,
    params: (m) => ({
      id: Number(m[1]),
      view: m[2] === 'besoins' ? 'besoins' : 'taches',
      fid: m[2] === 'dossier' && m[3] ? Number(m[3]) : null,
      nid: m[2] === 'besoins' && m[3] ? Number(m[3]) : null,
    }),
  },
  { re: /^\/$/, key: 'home', view: mountHome, params: () => ({}) },
];

let current = null; // { key, instance, mapId }

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname) return render();
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  render();
}

function render() {
  closeMenu();
  const path = location.pathname;
  let route = ROUTES.find((r) => r.re.test(path));
  if (!route) return navigate('/', { replace: true });

  if (!route.public && !store.user) return navigate('/connexion', { replace: true });
  if (route.public && store.user) return navigate('/', { replace: true });

  const params = route.params(path.match(route.re));

  // Meme vue (ex : ouverture d'un dossier dans la meme carte) : pas de remontage
  if (current && current.key === route.key && current.instance.onRoute && (route.key !== 'map' || current.mapId === params.id)) {
    current.instance.onRoute(params);
    return;
  }

  current?.instance.destroy?.();
  closeAllModals();
  const ctx = { store, navigate, params, logout, setUser };
  const instance = route.view(root, ctx) || {};
  current = { key: route.key, instance, mapId: params.id };

  if (store.user) connectRealtime(route.key === 'map' ? params.id : null);
  else disconnectRealtime();
}

function setUser(user) {
  store.user = user;
}

async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {}
  store.user = null;
  disconnectRealtime();
  current?.instance.destroy?.();
  current = null;
  navigate('/connexion', { replace: true });
}

setUnauthorizedHandler(() => {
  if (!store.user) return;
  store.user = null;
  disconnectRealtime();
  navigate('/connexion', { replace: true });
});

window.addEventListener('popstate', render);

// Liens internes <a data-link>
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

async function boot() {
  try {
    const { user } = await api.get('/api/auth/me');
    store.user = user;
  } catch {
    store.user = null;
  }
  document.body.classList.add('ready');
  render();
}

boot();
