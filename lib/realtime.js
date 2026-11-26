// ---------------------------------------------------------------------------
//  Temps reel : Server-Sent Events (SSE)
//  Chaque onglet ouvre un flux /api/events. Le serveur pousse :
//    - "map"      : une carte a change (le client recharge son etat)
//    - "moved"    : un dossier a ete deplace (mise a jour legere)
//    - "presence" : liste des membres en ligne sur une carte
//    - "invite"   : nouvelle invitation recue
//    - "maps"     : la liste de mes cartes a change (ajout / retrait)
//  Aucune dependance, fonctionne derriere Nginx/Apache (voir README).
// ---------------------------------------------------------------------------
import { memberIds } from './helpers.js';

const clients = new Set(); // { res, userId, mapId, clientId }

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* connexion morte : nettoyee a la fermeture */
  }
}

export function openStream(req, res, { userId, mapId, clientId }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // desactive le buffering Nginx pour ce flux
  });
  res.write('retry: 3000\n\n');
  req.socket.setKeepAlive?.(true);
  req.socket.setTimeout?.(0);

  const client = { res, userId, mapId, clientId };
  clients.add(client);
  if (mapId) broadcastPresence(mapId);

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {}
  }, 25e3);

  const close = () => {
    clearInterval(ping);
    if (!clients.delete(client)) return;
    if (mapId) broadcastPresence(mapId);
  };
  req.on('close', close);
  res.on('error', close);
}

export function onlineUsers(mapId) {
  const ids = new Set();
  for (const c of clients) if (c.mapId === mapId) ids.add(c.userId);
  return [...ids];
}

function broadcastPresence(mapId) {
  const online = onlineUsers(mapId);
  for (const c of clients) if (c.mapId === mapId) write(c.res, 'presence', { mapId, online });
}

export function sendToUsers(userIds, event, data) {
  const set = new Set(userIds);
  for (const c of clients) if (set.has(c.userId)) write(c.res, event, data);
}

// Notifie tous les membres d'une carte (quel que soit l'ecran ou ils sont)
export async function notifyMap(mapId, data = {}, event = 'map') {
  const ids = await memberIds(mapId);
  sendToUsers(ids, event, { mapId, ...data });
}

// Deconnecte un utilisateur d'une carte (retire des membres / carte supprimee)
export function kickFromMap(mapId, userIds) {
  const set = userIds ? new Set(userIds) : null;
  for (const c of clients) {
    if (c.mapId === mapId && (!set || set.has(c.userId))) write(c.res, 'kicked', { mapId });
  }
}
