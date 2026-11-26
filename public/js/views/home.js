// ---------------------------------------------------------------------------
//  Accueil : mes cartes mentales
// ---------------------------------------------------------------------------
import { api } from '../api.js';
import { h, mount, icon, svg, toast, menu, avatarStack, timeAgo, promptDialog, confirmDialog, debounce } from '../ui.js';
import { on } from '../realtime.js';
import { createTopbar } from '../components/topbar.js';

// Petite constellation decorative, deterministe pour chaque carte
function mapThumb(mapId, count, colors) {
  let seed = mapId * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const s = svg('svg', { viewBox: '0 0 300 120', class: 'thumb-art', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid slice' });
  const n = Math.max(3, Math.min(count || 3, 9));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const r = 34 + rnd() * 28;
    pts.push({ x: 150 + Math.cos(a) * r * 1.9, y: 60 + Math.sin(a) * r * 0.75 });
  }
  for (const p of pts) {
    const mx = (150 + p.x) / 2;
    s.append(svg('path', { d: `M150 60 C ${mx} 60, ${mx} ${p.y}, ${p.x} ${p.y}`, class: 'thumb-edge' }));
  }
  pts.forEach((p, i) => s.append(svg('rect', { x: p.x - 13, y: p.y - 8, width: 26, height: 16, rx: 5, class: 'thumb-node', style: `--c:${colors[i % colors.length]}` })));
  s.append(svg('circle', { cx: 150, cy: 60, r: 15, class: 'thumb-core' }));
  return s;
}

export function mountHome(root, { store, navigate, logout, setUser }) {
  let maps = null;
  const recentlyDeleted = new Set();

  const topbar = createTopbar({ store, navigate, logout, setUser, onUserChange: () => renderHero() });
  const hero = h('section.home-hero');
  const grid = h('div.map-grid');
  const page = h('main.home', hero, h('div.section-head', h('h2', 'Mes cartes'), h('span.count')), grid);
  mount(root, h('div.layout', topbar.el, page));

  function renderHero() {
    const mine = maps ? maps.reduce((s, m) => s + m.tasks.mine, 0) : 0;
    mount(
      hero,
      h(
        'div',
        h('p.eyebrow', new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })),
        h('h1', 'Salut ', h('span.grad-text', store.user.pseudo), ' 👋'),
        h(
          'p.hero-sub',
          maps === null
            ? 'Chargement de tes cartes…'
            : mine
              ? `Tu as ${mine} tâche${mine > 1 ? 's' : ''} en cours sur l’ensemble de tes projets.`
              : maps.length
                ? 'Aucune tâche en attente pour toi. Tranquille.'
                : 'Crée ta première carte et invite ton équipe.'
        )
      ),
      h('button.btn.btn-primary.btn-lg', { onclick: createMap }, icon('plus', 18), 'Nouvelle carte')
    );
  }

  function renderGrid() {
    page.querySelector('.count').textContent = maps?.length ? String(maps.length) : '';
    if (!maps) return mount(grid, [1, 2, 3].map(() => h('div.map-card.skeleton')));
    if (!maps.length) {
      return mount(
        grid,
        h(
          'div.empty-home',
          h('div.empty-art', mapThumb(7, 5, ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9'])),
          h('h3', 'Aucune carte pour l’instant'),
          h('p', 'Une carte = un projet. Tu y ranges des dossiers, et dans chaque dossier, les tâches de chacun.'),
          h('button.btn.btn-primary', { onclick: createMap }, icon('plus', 16), 'Créer ma première carte')
        )
      );
    }
    mount(
      grid,
      maps.map((m, i) => mapCard(m, i)),
      h('button.map-card.map-card-new', { onclick: createMap }, h('span.new-plus', icon('plus', 26)), h('b', 'Nouvelle carte'), h('small', 'Un nouveau projet de groupe'))
    );
  }

  function mapCard(m, i) {
    const pct = m.tasks.total ? Math.round((m.tasks.done / m.tasks.total) * 100) : 0;
    const owner = m.members.find((u) => u.id === m.owner_id);
    const more = h('button.icon-btn.card-more', { 'aria-label': 'Options', onclick: (e) => { e.stopPropagation(); cardMenu(more, m); } }, icon('more', 18));
    const card = h(
      'article.map-card',
      { tabIndex: 0, style: { animationDelay: i * 50 + 'ms' }, onclick: () => open(m, card), onkeydown: (e) => e.key === 'Enter' && open(m, card) },
      h('div.thumb', mapThumb(m.id, m.folders, m.members.map((u) => u.color).concat(['#6366f1', '#ec4899', '#10b981'])), more),
      h(
        'div.card-body',
        h('h3', m.name),
        h('p.card-meta', m.role === 'owner' ? 'Créée par toi' : `Par ${owner?.pseudo || '—'}`, ' · ', timeAgo(m.updated_at)),
        h(
          'div.card-progress',
          h('div.bar', h('i', { style: { width: pct + '%' } })),
          h('span', m.tasks.total ? `${m.tasks.done}/${m.tasks.total}` : 'Aucune tâche')
        ),
        h(
          'div.card-foot',
          avatarStack(m.members, { max: 5, size: 28 }),
          h('div.card-chips', h('span.chip', icon('folder', 13), m.folders), m.tasks.mine > 0 && h('span.chip.chip-accent', `${m.tasks.mine} pour toi`))
        )
      )
    );
    // Inclinaison 3D qui suit la souris
    card.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--rx', ((e.clientY - r.top) / r.height - 0.5) * -7 + 'deg');
      card.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 9 + 'deg');
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
    return card;
  }

  function open(m, card) {
    card.classList.add('opening');
    setTimeout(() => navigate(`/carte/${m.id}`), 180);
  }

  function cardMenu(anchor, m) {
    menu(anchor, [
      { icon: 'arrow', label: 'Ouvrir', onClick: () => navigate(`/carte/${m.id}`) },
      { icon: 'edit', label: 'Renommer', onClick: () => renameMap(m) },
      'sep',
      m.role === 'owner'
        ? { icon: 'trash', label: 'Supprimer la carte', danger: true, onClick: () => deleteMap(m) }
        : { icon: 'door', label: 'Quitter la carte', danger: true, onClick: () => leaveMap(m) },
    ]);
  }

  async function createMap() {
    const r = await promptDialog({ title: 'Nouvelle carte', label: 'Nom du projet', placeholder: 'ex : Projet réseau S3', confirmLabel: 'Créer la carte' });
    if (!r) return;
    try {
      const { map } = await api.post('/api/maps', { name: r.value });
      navigate(`/carte/${map.id}`);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function renameMap(m) {
    const r = await promptDialog({ title: 'Renommer la carte', label: 'Nom du projet', value: m.name, confirmLabel: 'Renommer' });
    if (!r) return;
    try {
      await api.patch(`/api/maps/${m.id}`, { name: r.value });
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function deleteMap(m) {
    const ok = await confirmDialog({
      title: 'Supprimer la carte ?',
      message: `« ${m.name} » et tous ses dossiers et tâches seront supprimés pour tous les membres. C’est définitif.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      recentlyDeleted.add(m.id);
      await api.del(`/api/maps/${m.id}`);
      toast('Carte supprimée', 'ok');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function leaveMap(m) {
    const ok = await confirmDialog({ title: 'Quitter la carte ?', message: `Tu ne verras plus « ${m.name} ». Tes tâches seront désassignées.`, confirmLabel: 'Quitter', danger: true });
    if (!ok) return;
    try {
      recentlyDeleted.add(m.id);
      await api.del(`/api/maps/${m.id}/members/${store.user.id}`);
      toast('Tu as quitté la carte', 'ok');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function load() {
    try {
      maps = (await api.get('/api/maps')).maps;
    } catch (e) {
      maps = maps || [];
      toast(e.message, 'err');
    }
    renderHero();
    renderGrid();
  }
  const reload = debounce(load, 250);

  const offs = [
    on('map', reload),
    on('reconnect', reload),
    on('maps', (d) => {
      if (d.deleted && !recentlyDeleted.has(d.mapId)) toast(`La carte « ${d.name} » a été supprimée`, 'info');
      if (d.removed) toast(`Tu as été retiré de « ${d.name} »`, 'info');
      reload();
    }),
  ];

  renderHero();
  renderGrid();
  load();

  return {
    destroy() {
      offs.forEach((f) => f());
      topbar.destroy();
    },
  };
}
