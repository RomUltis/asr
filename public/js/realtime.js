// ---------------------------------------------------------------------------
//  Temps reel : flux SSE unique par onglet, reconnexion automatique
// ---------------------------------------------------------------------------
import { CLIENT_ID } from './api.js';

const EVENTS = ['map', 'moved', 'presence', 'invite', 'maps', 'kicked'];
const handlers = new Map();
let source = null;
let currentMap = undefined;

function emit(type, data) {
  for (const fn of handlers.get(type) || []) {
    try {
      fn(data);
    } catch (e) {
      console.error('[realtime]', e);
    }
  }
}

// mapId : carte affichee (pour la presence), ou null sur l'accueil
export function connectRealtime(mapId = null) {
  if (source && currentMap === mapId && source.readyState !== EventSource.CLOSED) return;
  source?.close();
  currentMap = mapId;
  source = new EventSource(`/api/events?cid=${CLIENT_ID}${mapId ? `&map=${mapId}` : ''}`);
  // Apres une reconnexion, des evenements ont pu etre manques : on previent les vues
  let opened = false;
  source.addEventListener('open', () => {
    if (opened) emit('reconnect', {});
    opened = true;
  });
  for (const type of EVENTS) {
    source.addEventListener(type, (e) => {
      let data = {};
      try {
        data = JSON.parse(e.data);
      } catch {}
      emit(type, data);
    });
  }
}

export function disconnectRealtime() {
  source?.close();
  source = null;
  currentMap = undefined;
}

// Abonnement ; renvoie une fonction de desabonnement
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}

export const isOwnEvent = (data) => data && data.origin === CLIENT_ID;
