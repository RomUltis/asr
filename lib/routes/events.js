// ---------------------------------------------------------------------------
//  Flux temps reel (SSE) : GET /api/events?map=<id>&cid=<clientId>
// ---------------------------------------------------------------------------
import { requireAuth, isMember } from '../helpers.js';
import { openStream } from '../realtime.js';

export function register(router) {
  router.get('/api/events', async (ctx) => {
    requireAuth(ctx.user);
    let mapId = Number(ctx.query.get('map')) || null;
    if (mapId && !(await isMember(mapId, ctx.user.id))) mapId = null;
    const clientId = String(ctx.query.get('cid') || '').replace(/[^a-z0-9]/gi, '').slice(0, 40);
    openStream(ctx.req, ctx.res, { userId: ctx.user.id, mapId, clientId });
    return undefined; // la reponse reste ouverte
  });
}
