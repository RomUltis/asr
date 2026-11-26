// ---------------------------------------------------------------------------
//  Toile des besoins en 3D, organisee en ROUES PAR NIVEAU
//  Moteur maison sur <canvas> : projection perspective, camera orbitale,
//  champ d'etoiles en fond.
//  - Au centre : le projet (ou l'element dans lequel on a plonge).
//  - Roue 1 : ce qui depend directement du centre, roue 2 : ce qui depend de la
//    roue 1, etc. Chaque branche garde sa part de la roue (secteur).
//  - Les liens transverses (entre branches, entre niveaux) sont des arcs.
//  - Les elements d'autres branches relies a la toile visible sont sur une
//    roue exterieure "Ailleurs".
// ---------------------------------------------------------------------------
import { api } from '../api.js';
import { h, mount, icon, toast, modal, avatar, confirmDialog, promptDialog, debounce, hasOpenModal, prefersReducedMotion } from '../ui.js';

export const KINDS = {
  besoin: { label: 'Besoin', color: '#a5b4fc', core: '#eef2ff', r: 12 },
  solution: { label: 'À mettre en place', color: '#fbbf24', core: '#fef3c7', r: 8.5 },
  contrainte: { label: 'Contrainte', color: '#f87171', core: '#fee2e2', r: 8 },
};
const KIND_ORDER = { besoin: 0, solution: 1, contrainte: 2 };
const DONE = '#34d399';
const MAX_DEPTH = 6; // nombre de roues affichees sous le centre
const LEVEL_DROP = 70; // chaque roue est un peu plus basse : effet de cone en 3D
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const truncate = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

export function createWeb({ host, mapId, store, getState, applyState, navigate }) {
  let visible = false;
  let focus = null; // id du noeud au centre, ou null = projet
  let graph = { nodes: [], edges: [], rings: [], byKey: new Map(), focusLevel: 0 };
  const posCache = new Map(); // key -> position courante {x, y, z} (animations fluides)
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
  let focusPath = [];
  let deletedByMe = null;

  const cam = { yaw: 0.35, pitch: 0.95, dist: 900, autoDist: 900, zoom: 1, tx: 0, ty: 0, tz: 0 };

  // ------------------------------- DOM -------------------------------------
  const canvas = h('canvas.web-canvas');
  const ctx = canvas.getContext('2d');
  const crumbs = h('nav.web-crumbs', { 'aria-label': 'Chemin' });
  const counter = h('div.web-counter');
  const tip = h('div.web-tip');
  const panelBody = h('div.web-panel-body');
  const panel = h('aside.web-panel', panelBody);
  panel.addEventListener('focusout', () => setTimeout(() => pendingPanel && !panel.contains(document.activeElement) && renderPanel()));
  const panelToggle = h('button.web-panel-toggle', { onclick: () => setPanel(!panelOpen), 'aria-label': 'Afficher le panneau' }, icon('text', 18));
  const empty = h(
    'div.web-empty',
    h('div.web-empty-star', icon('sparkles', 26)),
    h('h3', 'La toile est vide'),
    h('p', 'Ajoute les besoins du projet : ils forment la première roue. Pour chaque élément, tu choisis de quoi il dépend et il se place sur la roue suivante.'),
    h('button.btn.btn-primary', { onclick: () => addNode() }, icon('plus', 16), 'Ajouter un besoin')
  );
  const legend = h(
    'div.web-legend',
    Object.entries(KINDS).map(([k, v]) => h('span', h('i', { class: 'lg-' + k, style: { '--c': v.color } }), v.label)),
    h('span', h('i.lg-done', { style: { '--c': DONE } }), 'Validé / en place'),
    h('span', h('i.lg-link'), 'Lien entre branches'),
    h('span', h('i.lg-member'), 'Membre')
  );
  const hint = h('div.web-hint', 'Glisser pour tourner · Molette pour zoomer · Survoler une étoile pour voir sa branche · Clic pour plonger dedans');
  const addBtn = h('button.web-add', { onclick: () => addNode(), 'aria-label': 'Ajouter un élément', title: 'Ajouter un élément (N)' }, icon('plus', 22));
  const el = h('section.web', { hidden: true }, canvas, h('div.web-top', crumbs, counter), legend, hint, empty, addBtn, panelToggle, panel, tip);
  host.append(el);

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
  const sortNodes = (list) => [...list].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.id - b.id);

  function childrenMap() {
    const m = new Map();
    for (const n of S().nodes) {
      const k = n.parent_id ?? 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(n);
    }
    for (const [k, v] of m) m.set(k, sortNodes(v));
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
  // Niveau absolu : 1 = depend directement du projet
  const levelOf = (id) => (id == null ? 0 : ancestors(id).length);

  function progressOf(id, kids) {
    const list = kids.get(id) || [];
    return { done: list.filter((n) => n.done).length, total: list.length };
  }

  // Options "Depend de" : arborescence complete avec indentation et niveau
  function dependencyOptions(selected, banned = new Set()) {
    const kids = childrenMap();
    const opts = [h('option', { value: '', selected: selected == null }, `✦ ${S().map.name} (projet) → niveau 1`)];
    const walk = (pid, depth) => {
      for (const n of kids.get(pid) || []) {
        if (banned.has(n.id)) continue;
        const pad = '  '.repeat(depth - 1) + (depth > 1 ? '└ ' : '');
        opts.push(h('option', { value: n.id, selected: n.id === selected }, `${pad}${truncate(n.title, 46)} → niveau ${depth + 1}`));
        walk(n.id, depth + 1);
      }
    };
    walk(0, 1);
    return opts;
  }

  // --------------------- Construction des roues ---------------------------
  function buildGraph() {
    const s = S();
    const kids = childrenMap();
    if (focus != null && !nodeById(focus)) focus = null;
    const focusLevel = levelOf(focus);
    const g = { nodes: [], edges: [], rings: [], byKey: new Map(), focusLevel };

    // 1. Arbre visible sous le centre (limite a MAX_DEPTH roues)
    const tree = (n, depth) => ({
      n,
      depth,
      children: depth < MAX_DEPTH ? (kids.get(n ? n.id : 0) || []).map((c) => tree(c, depth + 1)) : [],
    });
    const root = tree(focus != null ? nodeById(focus) : null, 0);
    // poids d'une branche : 1 pour l'element + une part de ses enfants (equilibre les secteurs)
    const weight = (t) => (t.w = 1 + 0.65 * t.children.reduce((a, c) => a + weight(c), 0));
    weight(root);

    // 2. Secteur angulaire de chaque etoile (pour calculer l'ecart minimal par roue)
    const perLevel = [];
    const minSpan = [];
    const spans = (t, span) => {
      perLevel[t.depth] = (perLevel[t.depth] || 0) + 1;
      if (t.depth > 0) minSpan[t.depth] = Math.min(minSpan[t.depth] ?? Infinity, span);
      const total = t.children.reduce((a, c) => a + c.w, 0);
      for (const c of t.children) spans(c, (span * c.w) / total);
    };
    spans(root, Math.PI * 2);

    // 3. Rayon de chaque roue : au moins 62 px d'arc entre deux etoiles voisines
    const radius = [0];
    for (let l = 1; l < perLevel.length; l++) {
      radius[l] = clamp(Math.max(radius[l - 1] + (l === 1 ? 230 : 160), 62 / (minSpan[l] || 1)), 0, radius[l - 1] + 1100);
    }

    // 4. Secteurs : chaque branche recoit sa part de roue
    const props = (n, depth) => {
      const k = KINDS[n.kind] || KINDS.besoin;
      const pr = progressOf(n.id, kids);
      return {
        type: 'node',
        id: n.id,
        parent: n.parent_id,
        depth,
        level: focusLevel + depth,
        kind: n.kind,
        title: n.title,
        done: n.done,
        assignee: n.assignee_id,
        color: k.color,
        core: k.core,
        r: depth === 0 ? 24 : Math.max(5.5, k.r * (1.2 - depth * 0.12)),
        inside: pr.total,
        insideDone: pr.done,
        hiddenBelow: depth === MAX_DEPTH && pr.total > 0,
      };
    };
    const place = (key, data, gx, gy, gz, from) => {
      const prev = posCache.get(key) || (from && posCache.get(from)) || { x: gx * 0.2, y: gy * 0.2, z: gz * 0.2 };
      const n = { key, ...data, gx, gy, gz, x: prev.x, y: prev.y, z: prev.z };
      g.nodes.push(n);
      g.byKey.set(key, n);
      return n;
    };

    let center;
    if (focus == null) {
      const total = s.nodes.filter((n) => n.kind === 'besoin').length;
      const done = s.nodes.filter((n) => n.kind === 'besoin' && n.done).length;
      center = place('root', { type: 'root', depth: 0, level: 0, title: s.map.name, r: 28, color: '#c4b5fd', core: '#ffffff', inside: total, insideDone: done }, 0, 0, 0);
    } else center = place('n' + focus, props(root.n, 0), 0, 0, 0);

    const assign = (t, a0, a1, parentNode) => {
      let a = a0;
      const total = t.children.reduce((s2, c) => s2 + c.w, 0);
      for (const c of t.children) {
        const span = ((a1 - a0) * c.w) / total;
        const ang = a + span / 2;
        const R = radius[c.depth];
        const node = place('n' + c.n.id, { ...props(c.n, c.depth), angle: ang }, Math.cos(ang) * R, c.depth * LEVEL_DROP, Math.sin(ang) * R, parentNode.key);
        g.edges.push({ a: parentNode, b: node, type: 'tree' });
        assign(c, a, a + span, node);
        a += span;
      }
    };
    assign(root, -Math.PI / 2, Math.PI * 1.5, center);

    const maxDepth = perLevel.length - 1;
    for (let l = 1; l <= maxDepth; l++) g.rings.push({ depth: l, level: focusLevel + l, R: radius[l], y: l * LEVEL_DROP });

    // 4. Liens transverses : arcs entre etoiles visibles, ou vers la roue "Ailleurs"
    const outerR = (radius[maxDepth] || 0) + 190;
    const outerY = (maxDepth + 1) * LEVEL_DROP;
    let ghosts = 0;
    for (const l of s.links) {
      let A = g.byKey.get('n' + l.source_id);
      let B = g.byKey.get('n' + l.target_id);
      if (!A && !B) continue;
      if (!A || !B) {
        const known = A || B;
        const other = nodeById(A ? l.target_id : l.source_id);
        if (!other) continue;
        let gh = g.byKey.get('n' + other.id);
        if (!gh) {
          const ang = (known.angle ?? 0) + (ghosts++ % 3) * 0.09;
          const path = ancestors(other.id);
          gh = place(
            'n' + other.id,
            { ...props(other, maxDepth + 1), ghost: true, level: path.length, where: path.length > 1 ? path[0].title : null, r: 7 },
            Math.cos(ang) * outerR,
            outerY,
            Math.sin(ang) * outerR,
            known.key
          );
        }
        if (A) B = gh;
        else A = gh;
      }
      g.edges.push({ a: A, b: B, type: 'link' });
    }
    if (g.nodes.some((n) => n.ghost)) g.rings.push({ depth: maxDepth + 1, level: null, R: outerR, y: outerY, outer: true });

    // 5. Membres : petite couronne au-dessus du centre, reliee a ce dont ils s'occupent
    const involved = new Set(g.nodes.filter((n) => n.type === 'node' && n.assignee).map((n) => n.assignee));
    const shown = focus == null ? s.members : s.members.filter((m) => involved.has(m.id));
    shown.forEach((m, i) => {
      const ang = (i / Math.max(1, shown.length)) * Math.PI * 2 + 0.4;
      const node = place('m' + m.id, { type: 'member', id: m.id, depth: 1, title: m.pseudo, color: m.color, core: m.color, r: 9, online: s.online.includes(m.id) }, Math.cos(ang) * 120, -170, Math.sin(ang) * 120, 'root');
      for (const n of g.nodes) if (n.type === 'node' && n.assignee === m.id) g.edges.push({ a: node, b: n, type: 'member' });
    });

    graph = g;
  }

  // Branche d'une etoile : ses ancetres, ses descendants et ce qui y est relie
  function branchOf(node) {
    const set = new Set([node.key]);
    if (!node || node.type === 'root') return null;
    if (node.type === 'member') {
      for (const e of graph.edges) if (e.type === 'member' && e.a === node) set.add(e.b.key);
      return set;
    }
    let cur = node;
    while (cur && cur.parent != null) {
      const p = graph.byKey.get('n' + cur.parent);
      if (!p) break;
      set.add(p.key);
      cur = p;
    }
    set.add(focus == null ? 'root' : 'n' + focus);
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      for (const e of graph.edges) if (e.type === 'tree' && e.a === n && !set.has(e.b.key)) { set.add(e.b.key); stack.push(e.b); }
    }
    for (const e of graph.edges) {
      if (e.type === 'link' && (set.has(e.a.key) || set.has(e.b.key)) && (e.a === node || e.b === node)) set.add(e.a.key).add(e.b.key);
      if (e.type === 'member' && e.b === node) set.add(e.a.key);
    }
    return set;
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
    return { x: cx + x1 * s, y: H / 2 + y2 * s - 20, s, depth };
  }

  // Distance pour que toutes les roues + leurs etiquettes tiennent a l'ecran
  function fitDistance() {
    let R = 160;
    for (const r of graph.rings) R = Math.max(R, r.R + 30);
    const availW = panelOpen && W > 900 ? W - 360 : W;
    const halfW = Math.max(120, availW / 2 - Math.min(170, availW * 0.18)); // place pour les etiquettes
    const halfH = Math.max(120, H / 2 - 70);
    const byW = (R * F) / halfW;
    const byH = (R * Math.sin(cam.pitch) * F) / halfH + R * Math.cos(cam.pitch) * 0.6;
    return clamp(Math.max(byW, byH), 420, 5000);
  }

  // ------------------------------- Rendu -----------------------------------
  const FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

  function label(text, x, y, size, weight, color, alpha, align) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = `rgba(6, 9, 24, ${0.85 * alpha})`;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = rgba(color, alpha);
    ctx.fillText(text, x, y);
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    for (const st of stars) {
      const p = project(st.x, st.y, st.z, false);
      if (!p) continue;
      const tw = 0.55 + 0.45 * Math.sin(t * 0.0015 + st.tw);
      ctx.fillStyle = `rgba(200, 210, 255, ${0.5 * tw})`;
      ctx.fillRect(p.x, p.y, st.size, st.size);
    }

    for (const n of graph.nodes) n.p = project(n.x, n.y, n.z);
    const centerP = graph.nodes[0]?.p;
    const fog = (p) => (p ? clamp(1.35 - (p.depth - cam.dist * 0.6) / (cam.dist * 1.2), 0.14, 1) : 0);
    const active = hoverKey || panelHoverKey;
    const activeNode = active && graph.byKey.get(active);
    const branch = activeNode ? branchOf(activeNode) : null;
    const inBranch = (n) => !branch || branch.has(n.key);

    // Roues (une par niveau) + leur numero
    for (const ring of graph.rings) {
      const pts = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        pts.push(project(Math.cos(a) * ring.R, ring.y, Math.sin(a) * ring.R));
      }
      const hl = activeNode && activeNode.depth === ring.depth && !activeNode.ghost === !ring.outer;
      ctx.setLineDash(ring.outer ? [3, 7] : []);
      ctx.lineWidth = hl ? 1.6 : 1;
      ctx.strokeStyle = ring.outer ? `rgba(148, 163, 184, ${0.22 * fade})` : `rgba(165, 180, 252, ${(hl ? 0.38 : 0.16) * fade})`;
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        if (!p) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // etiquette au point le plus proche du spectateur (bas de l'ecran)
      const front = pts.filter(Boolean).reduce((b, p) => (!b || p.y > b.y ? p : b), null);
      if (front) {
        const txt = ring.outer ? 'Relié depuis ailleurs' : `Niveau ${ring.level}`;
        ctx.font = `700 11px ${FONT}`;
        const w = ctx.measureText(txt).width + 16;
        ctx.fillStyle = ring.outer ? `rgba(30, 41, 59, ${0.85 * fade})` : `rgba(30, 27, 75, ${0.85 * fade})`;
        ctx.beginPath();
        ctx.roundRect(front.x - w / 2, front.y + 6, w, 20, 10);
        ctx.fill();
        label(txt, front.x, front.y + 20, 11, 700, ring.outer ? '#94a3b8' : '#a5b4fc', (hl ? 1 : 0.85) * fade, 'center');
      }
    }

    // Liens : arborescence (traits), liens entre branches (arcs), membres
    ctx.lineCap = 'round';
    for (const e of graph.edges) {
      const pa = e.a.p, pb = e.b.p;
      if (!pa || !pb) continue;
      const hl = branch && branch.has(e.a.key) && branch.has(e.b.key);
      const dim = branch && !hl;
      const al = Math.min(fog(pa), fog(pb)) * fade * (dim ? 0.18 : 1);
      if (e.type === 'link') {
        // arc qui passe au-dessus de la toile
        const mx = (e.a.x + e.b.x) / 2, mz = (e.a.z + e.b.z) / 2;
        const len = Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y, e.a.z - e.b.z);
        const cpt = project(mx, Math.min(e.a.y, e.b.y) - 60 - len * 0.32, mz);
        if (!cpt) continue;
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = rgba('#fbbf24', (hl ? 0.95 : branch ? 0.15 : 0.38) * al);
        ctx.lineWidth = hl ? 2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo(cpt.x, cpt.y, pb.x, pb.y);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      if (e.type === 'member') {
        if (!hl && branch) continue;
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = rgba(e.a.color, (hl ? 0.85 : 0.22) * al);
        ctx.lineWidth = hl ? 1.5 : 1;
      } else {
        ctx.setLineDash([]);
        const col = e.b.done ? DONE : '#c7d2fe';
        ctx.strokeStyle = rgba(col, (hl ? 0.9 : e.a.depth === 0 ? 0.4 : 0.3) * al);
        ctx.lineWidth = (hl ? 2.2 : e.a.depth === 0 ? 1.5 : 1.1) * clamp(pa.s, 0.6, 1.6);
      }
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (e.type === 'tree' && e.a.depth === 0 && !prefersReducedMotion()) {
        const k = ((t * 0.00035 + (e.b.id || 0) * 0.137) % 1 + 1) % 1;
        ctx.fillStyle = rgba(e.b.done ? DONE : '#e0e7ff', 0.75 * al * Math.sin(k * Math.PI));
        ctx.beginPath();
        ctx.arc(pa.x + (pb.x - pa.x) * k, pa.y + (pb.y - pa.y) * k, 1.8 * clamp(pa.s, 0.6, 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Etoiles, de la plus lointaine a la plus proche
    const order = graph.nodes.filter((n) => n.p).sort((a, b) => b.p.depth - a.p.depth);
    for (const n of order) {
      const p = n.p;
      const isActive = n === activeNode;
      const dim = branch && !inBranch(n);
      const al = fog(p) * fade * (dim ? 0.22 : 1) * (n.ghost ? 0.7 : 1);
      const r = n.r * p.s;
      const col = n.done ? DONE : n.ghost ? '#94a3b8' : n.color;

      const halo = r * (n.type === 'root' ? 4 : 3);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo);
      g.addColorStop(0, rgba(col, (isActive ? 0.75 : 0.42) * al));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = al;
      if (n.kind === 'contrainte') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = n.done ? DONE : n.ghost ? '#94a3b8' : '#f87171';
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
        ctx.fillStyle = n.done ? '#d1fae5' : n.ghost ? '#1e293b' : n.core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.strokeStyle = col;
        ctx.stroke();
        if (n.depth === 0) {
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
        } else if (n.hiddenBelow) {
          // il reste des niveaux plus profonds : petits points qui tournent
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

      n.al = al;
    }

    // Etiquettes : les plus importantes d'abord, une etiquette qui en chevauche
    // une autre est masquee (elle reapparait au survol de sa branche)
    const prio = (n) => (n === activeNode ? -3 : branch && branch.has(n.key) ? -2 : n.depth === 0 ? -1 : 0);
    const queue = order
      .filter((n) => n.al > 0.06)
      .sort((a, b) => prio(a) - prio(b) || a.depth - b.depth || a.p.depth - b.p.depth);
    const boxes = [];
    const overlaps = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    for (const n of queue) {
      const p = n.p;
      const r = n.r * p.s;
      const forced = prio(n) < 0;
      const size = (n.depth === 0 ? 17 : n.type === 'member' ? 12 : n.depth === 1 ? 13.5 : n.depth === 2 ? 12 : 11) * clamp(p.s, 0.8, 1.3);
      const weight = n.depth <= 1 || n.type === 'member' ? 650 : 550;
      const txt = (n.ghost && n.where ? `↗ ${truncate(n.where, 18)} › ` : '') + truncate(n.title, n.depth === 0 ? 40 : 32);
      ctx.font = `${weight} ${size}px ${FONT}`;
      const w = ctx.measureText(txt).width;
      let x, y, align;
      if (n.depth === 0) {
        align = 'center';
        x = p.x;
        y = p.y + r * 1.45 + size + 6;
      } else {
        const right = !centerP || p.x >= centerP.x;
        align = right ? 'left' : 'right';
        x = right ? p.x + r + 7 : p.x - r - 7;
        y = p.y + size * 0.36;
      }
      const box = { x: align === 'center' ? x - w / 2 : align === 'left' ? x : x - w, y: y - size, w, h: size * 1.3 };
      if (!forced && overlaps(box)) continue;
      boxes.push(box);
      const color = n.type === 'member' ? n.color : n.kind === 'contrainte' && !n.ghost ? '#fca5a5' : n.done ? '#a7f3d0' : n.ghost ? '#94a3b8' : n.depth <= 1 ? '#ffffff' : '#cbd5e1';
      label(txt, x, y, size, weight, color, n.al, align);
    }
  }

  // --------------------------- Boucle principale ---------------------------
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, t - (lastT || t));
    lastT = t;
    // les etoiles glissent vers leur place (ajouts, suppressions, deplacements)
    const k = 1 - Math.exp(-dt / 220);
    for (const n of graph.nodes) {
      n.x += (n.gx - n.x) * k;
      n.y += (n.gy - n.y) * k;
      n.z += (n.gz - n.z) * k;
      posCache.set(n.key, { x: n.x, y: n.y, z: n.z });
    }
    if (!drag && !hoverKey && !panelHoverKey && !busy && t - lastInteract > 2500 && !prefersReducedMotion()) cam.yaw += 0.0001 * dt;
    if (!busy) {
      cam.autoDist += (fitDistance() - cam.autoDist) * (1 - Math.exp(-dt / 350));
      cam.dist = cam.autoDist * cam.zoom;
    }
    draw(t);
  }

  function snap() {
    for (const n of graph.nodes) {
      n.x = n.gx;
      n.y = n.gy;
      n.z = n.gz;
      posCache.set(n.key, { x: n.x, y: n.y, z: n.z });
    }
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
      cam.zoom = clamp((drag.zoom * drag.pinch) / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 0.3, 3);
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
        cam.pitch = clamp(drag.pitch + dy * 0.006, -0.2, 1.45);
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
    if (!n || n.type === 'member' || n.type === 'root') return;
    if (n.depth === 0) return setPanel(true);
    navigate(`/carte/${mapId}/besoins/${n.id}`);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => !drag && setHover(null));
  canvas.addEventListener('dblclick', (e) => {
    const n = hit(e.offsetX, e.offsetY);
    if (!n) addNode();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      lastInteract = performance.now();
      cam.zoom = clamp(cam.zoom * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), 0.3, 3);
    },
    { passive: false }
  );

  function setHover(key, x, y) {
    if (key === hoverKey && !key) return;
    hoverKey = key;
    canvas.style.cursor = key ? 'pointer' : '';
    const n = key && graph.byKey.get(key);
    if (!n) return tip.classList.remove('show');
    const kind = n.type === 'root' ? 'Projet' : n.type === 'member' ? 'Membre' : (KINDS[n.kind] || KINDS.besoin).label;
    const resp = n.assignee && member(n.assignee);
    const parent = n.type === 'node' && n.parent != null ? nodeById(n.parent) : null;
    const owned = n.type === 'member' ? S().nodes.filter((x) => x.assignee_id === n.id) : [];
    const links = n.type === 'node' ? S().links.filter((l) => l.source_id === n.id || l.target_id === n.id).length : 0;
    mount(
      tip,
      h('small', { class: 'k-' + (n.kind || n.type) }, kind, n.type === 'node' ? ` · niveau ${n.level}` : '', n.done ? ' · ✓ validé' : ''),
      h('b', n.title),
      n.type === 'node' && h('span', 'Dépend de : ', parent ? parent.title : S().map.name),
      n.type === 'node' && n.inside > 0 && h('span', `${n.insideDone}/${n.inside} en place juste en dessous`),
      links > 0 && h('span', `Relié à ${plural(links, 'autre élément')}`),
      resp && h('span', 'Responsable : ', resp.pseudo),
      n.type === 'member' && h('span', owned.length ? `S’occupe de ${plural(owned.length, 'élément')}` : 'Aucun élément assigné'),
      n.type === 'node' && n.depth > 0 && h('em', n.ghost ? 'Autre branche · clique pour y aller' : 'Clique pour plonger dedans')
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
    await tween(520, (k) => {
      if (goingIn) {
        cam.tx = from.tx + (target.x - from.tx) * k;
        cam.ty = from.ty + (target.y - from.ty) * k;
        cam.tz = from.tz + (target.z - from.tz) * k;
        cam.dist = from.dist * (1 - 0.8 * k);
      } else cam.dist = from.dist * (1 + 1.4 * k);
      fade = 1 - k;
    });
    focus = next;
    posCache.clear();
    buildGraph();
    snap();
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
        h('button.crumb', { class: i === path.length - 1 ? 'current' : '', onclick: () => navigate(`/carte/${mapId}/besoins/${n.id}`), title: `Niveau ${i + 1}` }, h('small.crumb-lvl', String(i + 1)), truncate(n.title, 28)),
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
    const fLevel = levelOf(focus);
    const list = kids.get(focus ?? 0) || [];
    const listTitle = f ? `Ce qui en dépend · niveau ${fLevel + 1}` : 'Niveau 1 · dépend directement du projet';

    const item = (n) => {
      const k = KINDS[n.kind] || KINDS.besoin;
      const pr = progressOf(n.id, kids);
      const resp = n.assignee_id && member(n.assignee_id);
      return h(
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
    };

    const kindSelect = (value) =>
      h('select.input.input-sm', Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: k === value }, v.label)));

    // Ajout rapide : depend du centre actuel
    const quickInput = h('input.input.input-sm.wp-quick-input', { placeholder: f ? `Ajouter (niveau ${fLevel + 1})…` : 'Ajouter un besoin (niveau 1)…', maxLength: 120 });
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
      h('button.btn.btn-primary.btn-sm', { type: 'submit', 'aria-label': 'Ajouter' }, icon('plus', 15)),
      h('button.btn.btn-ghost.btn-sm.wp-more-add', { type: 'button', onclick: () => addNode(), title: 'Choisir de quoi il dépend, le relier…' }, 'Plus d’options')
    );

    if (!f) {
      const needs = s.nodes.filter((n) => n.kind === 'besoin');
      const done = needs.filter((n) => n.done).length;
      const depthCount = Math.max(0, ...s.nodes.map((n) => levelOf(n.id)));
      mount(
        panelBody,
        h(
          'div.wp-head',
          h('span.wp-kind', icon('sparkles', 13), 'Projet'),
          h('h2', s.map.name),
          h('p.wp-sub', `${plural(s.nodes.length, 'élément')} sur ${plural(depthCount, 'niveau')} · ${plural(s.links.length, 'lien')} entre branches`)
        ),
        h('div.wp-progress', h('div.bar', h('i', { style: { width: (needs.length ? (done / needs.length) * 100 : 0) + '%' } })), h('span', `${done}/${needs.length} validés`)),
        h('h4', listTitle),
        h('div.wp-list', list.length ? list.map(item) : h('p.wp-empty', 'Aucun besoin pour l’instant.')),
        quick
      );
      return;
    }

    const k = KINDS[f.kind] || KINDS.besoin;
    const pr = progressOf(f.id, kids);
    const parent = f.parent_id ? nodeById(f.parent_id) : null;
    const desc = h('textarea.input.wp-desc', { rows: 8, placeholder: 'Détails, pourquoi, comment…', maxLength: 4000 });
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

    // Liens entre branches
    const myLinks = s.links.filter((l) => l.source_id === f.id || l.target_id === f.id);
    const linkedIds = new Set(myLinks.map((l) => (l.source_id === f.id ? l.target_id : l.source_id)));
    const banned = new Set([f.id]);
    const stack = [...(kids.get(f.id) || [])];
    while (stack.length) {
      const n = stack.pop();
      banned.add(n.id);
      stack.push(...(kids.get(n.id) || []));
    }
    const linkSel = h(
      'select.input.input-sm',
      h('option', { value: '' }, '+ Relier à un élément d’une autre branche…'),
      dependencyOptions(null, new Set([f.id, f.parent_id, ...linkedIds])).slice(1)
    );
    linkSel.addEventListener('change', async () => {
      if (!linkSel.value) return;
      try {
        applyState((await api.post(`/api/maps/${mapId}/links`, { source_id: f.id, target_id: Number(linkSel.value) })).state);
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    // "Depend de" : changer de parent = changer de roue
    const parentSel = h(
      'select.input.input-sm',
      { onchange: (e) => patch(f.id, { parent_id: e.target.value ? Number(e.target.value) : null }) },
      dependencyOptions(f.parent_id ?? null, banned)
    );

    mount(
      panelBody,
      h(
        'div.wp-head',
        h('span.wp-kind', { style: { '--c': k.color } }, h('i.kdot', { class: 'k-' + f.kind, style: { '--c': k.color } }), k.label, h('span.wp-level', `Niveau ${fLevel}`)),
        h('h2', h('button.wp-title', { onclick: () => rename(f), title: 'Renommer' }, f.title, icon('edit', 14))),
        h('p.wp-sub', 'Dépend de ', h('button.wp-link', { onclick: () => goUp() }, parent ? parent.title : s.map.name), pr.total ? ` · ${pr.done}/${pr.total} en place en dessous` : '')
      ),
      h(
        'label.switch.wp-switch',
        h('input', { type: 'checkbox', checked: f.done, onchange: (e) => patch(f.id, { done: e.target.checked }) }),
        h('span.switch-ui'),
        h('span', f.kind === 'besoin' ? 'Besoin validé' : f.kind === 'contrainte' ? 'Contrainte respectée' : 'En place')
      ),
      h('div.wp-grid', h('label.field', h('span.field-label', 'Type'), kindSel), h('label.field', h('span.field-label', 'Responsable'), resp)),
      h('label.field', h('span.field-label', 'Dépend de (choisit sa roue)'), parentSel),
      h('label.field', h('span.field-label', 'Description'), desc),
      h('h4', listTitle),
      h('div.wp-list', list.length ? list.map(item) : h('p.wp-empty', 'Rien ne dépend encore de cet élément.')),
      quick,
      h('h4', 'Relié à d’autres branches'),
      h(
        'div.wp-list',
        myLinks.length
          ? myLinks.map((l) => {
              const o = nodeById(l.source_id === f.id ? l.target_id : l.source_id);
              if (!o) return null;
              const ok = KINDS[o.kind] || KINDS.besoin;
              return h(
                'div.wp-item',
                { onmouseenter: () => (panelHoverKey = 'n' + o.id), onmouseleave: () => (panelHoverKey = null) },
                h(
                  'button.wp-item-main',
                  { onclick: () => navigate(`/carte/${mapId}/besoins/${o.id}`) },
                  h('i.kdot', { class: 'k-' + o.kind, style: { '--c': ok.color } }),
                  h('span.wp-item-title', o.title),
                  h('small', `niv. ${levelOf(o.id)}`)
                ),
                h('button.icon-btn.wp-unlink', { 'aria-label': 'Retirer le lien', title: 'Retirer le lien', onclick: () => unlink(l.id) }, icon('x', 14))
              );
            })
          : h('p.wp-empty', 'Aucun lien avec d’autres branches.')
      ),
      linkSel,
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
      message: c ? `« ${n.title} » et les ${plural(c, 'élément')} qui en dépendent seront supprimés pour tout le monde.` : `« ${n.title} » sera supprimé pour tout le monde.`,
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

  // Creation : titre, type, DE QUOI IL DEPEND (=> sa roue et son niveau), liens
  function addNode() {
    const s = S();
    let parentId = focus;
    let kind = parentId == null ? 'besoin' : 'solution';
    let kindTouched = false;
    const picked = new Set();

    const title = h('input.input', { placeholder: 'ex : Sauvegarde externalisée', maxLength: 120, autofocus: true, required: true });
    const kindBtns = Object.entries(KINDS).map(([k, v]) =>
      h('button.kind-opt', { type: 'button', dataset: { k }, style: { '--c': v.color }, onclick: () => { kind = k; kindTouched = true; renderKind(); } }, h('i.kdot', { class: 'k-' + k, style: { '--c': v.color } }), v.label)
    );
    const renderKind = () => kindBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
    renderKind();

    const parentSel = h('select.input', dependencyOptions(parentId));
    const where = h('div.dep-where');
    const renderWhere = () => {
      const p = parentId != null ? nodeById(parentId) : null;
      const lvl = levelOf(parentId) + 1;
      const siblings = (childrenMap().get(parentId ?? 0) || []).length;
      mount(
        where,
        h('span.dep-level', `Niveau ${lvl}`),
        h('span', p ? ['Sur la roue de ', h('b', p.title)] : ['Sur la première roue, autour de ', h('b', s.map.name)], siblings ? ` · à côté de ${plural(siblings, 'autre élément')}` : '')
      );
    };
    parentSel.addEventListener('change', () => {
      parentId = parentSel.value ? Number(parentSel.value) : null;
      if (!kindTouched) {
        kind = parentId == null ? 'besoin' : 'solution';
        renderKind();
      }
      renderWhere();
      renderLinks();
    });
    renderWhere();

    // Liens vers d'autres branches (facultatif)
    const search = h('input.input.input-sm', { placeholder: 'Filtrer…', type: 'search' });
    const linkList = h('div.dep-links');
    const renderLinks = () => {
      const q = search.value.trim().toLowerCase();
      const items = s.nodes.filter((n) => n.id !== parentId && (!q || n.title.toLowerCase().includes(q)));
      mount(
        linkList,
        items.length
          ? items.map((n) => {
              const kk = KINDS[n.kind] || KINDS.besoin;
              const path = ancestors(n.id);
              return h(
                'label.dep-link',
                h('input', { type: 'checkbox', checked: picked.has(n.id), onchange: (e) => (e.target.checked ? picked.add(n.id) : picked.delete(n.id)) }),
                h('i.kdot', { class: 'k-' + n.kind, style: { '--c': kk.color } }),
                h('span.dep-link-title', n.title),
                h('small', path.length > 1 ? `${truncate(path[0].title, 16)} · niv. ${path.length}` : `niv. ${path.length}`)
              );
            })
          : h('p.dep-empty', 'Aucun élément.')
      );
    };
    search.addEventListener('input', renderLinks);
    renderLinks();

    const form = h(
      'form#modal-form.stack.dep-form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          if (!title.value.trim()) return title.focus();
          try {
            const r = await api.post(`/api/maps/${mapId}/nodes`, { title: title.value.trim(), kind, parent_id: parentId, link_ids: [...picked] });
            applyState(r.state);
            m.close();
            toast(picked.size ? `Ajouté et relié à ${plural(picked.size, 'élément')}` : 'Élément ajouté', 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
      h('label.field', h('span.field-label', 'Titre'), title),
      h('div.field', h('span.field-label', 'Type'), h('div.kind-picker', kindBtns)),
      h('label.field', h('span.field-label', 'Dépend de'), parentSel, where),
      s.nodes.length > 0 &&
        h(
          'details.dep-more',
          h('summary', icon('link', 14), 'Relier aussi à d’autres branches (facultatif)'),
          h('p.field-hint', 'Pour un élément qui sert aussi ailleurs, à n’importe quel niveau : un arc pointillé les reliera.'),
          search,
          linkList
        )
    );
    const m = modal({
      title: 'Ajouter un élément',
      subtitle: 'Choisis de quoi il dépend : il se place sur la bonne roue, au bon niveau.',
      body: form,
      width: 540,
      actions: [{ label: 'Annuler', onClick: () => m.close() }, { label: 'Ajouter', kind: 'primary', submit: true }],
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
      snap();
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
      const back = [...focusPath].reverse().find((nid) => nid !== focus && nodeById(nid));
      if (deletedByMe !== focus) toast('Cet élément vient d’être supprimé', 'info');
      deletedByMe = null;
      navigate(back ? `/carte/${mapId}/besoins/${back}` : `/carte/${mapId}/besoins`, { replace: true });
      return;
    }
    buildGraph(); // les etoiles glissent ensuite vers leur nouvelle place
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
