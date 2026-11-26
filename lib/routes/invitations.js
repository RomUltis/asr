// ---------------------------------------------------------------------------
//  Invitations recues (la cloche) : lister, accepter, refuser, annuler
// ---------------------------------------------------------------------------
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import { requireAuth, requireMember, id, touchMap } from '../helpers.js';
import { notifyMap, sendToUsers } from '../realtime.js';

async function myPendingInvitation(user, invId) {
  requireAuth(user);
  const inv = await db.prepare('SELECT * FROM invitations WHERE id = ?').get(id(invId));
  if (!inv || inv.invitee_id !== user.id) throw new HttpError(404, 'Invitation introuvable');
  if (inv.status !== 'pending') throw new HttpError(410, 'Cette invitation a déjà été traitée');
  return inv;
}

export function register(router) {
  router.get('/api/invitations', async (ctx) => {
    requireAuth(ctx.user);
    const invitations = await db
      .prepare(
        `SELECT i.id, i.created_at, m.id AS map_id, m.name AS map_name,
                u.pseudo AS inviter, u.color AS inviter_color,
                (SELECT COUNT(*) FROM map_members mm WHERE mm.map_id = m.id) AS members
         FROM invitations i
         JOIN maps m ON m.id = i.map_id
         JOIN users u ON u.id = i.inviter_id
         WHERE i.invitee_id = ? AND i.status = 'pending'
         ORDER BY i.created_at DESC`
      )
      .all(ctx.user.id);
    return { data: { invitations: invitations.map((i) => ({ ...i, members: Number(i.members) })) } };
  });

  router.post('/api/invitations/:id/accept', async (ctx) => {
    const inv = await myPendingInvitation(ctx.user, ctx.params.id);
    const t = now();
    const already = await db.prepare('SELECT 1 FROM map_members WHERE map_id = ? AND user_id = ?').get(inv.map_id, ctx.user.id);
    if (!already)
      await db.prepare("INSERT INTO map_members (map_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(inv.map_id, ctx.user.id, t);
    await db.prepare("UPDATE invitations SET status = 'accepted', responded_at = ? WHERE id = ?").run(t, inv.id);
    await touchMap(inv.map_id);
    await notifyMap(inv.map_id, { kind: 'member', joined: ctx.user.pseudo });
    sendToUsers([ctx.user.id], 'invite', {});
    sendToUsers([ctx.user.id], 'maps', { mapId: inv.map_id });
    return { data: { ok: true, mapId: inv.map_id } };
  });

  router.post('/api/invitations/:id/decline', async (ctx) => {
    const inv = await myPendingInvitation(ctx.user, ctx.params.id);
    await db.prepare("UPDATE invitations SET status = 'declined', responded_at = ? WHERE id = ?").run(now(), inv.id);
    await notifyMap(inv.map_id, { kind: 'invite' });
    sendToUsers([ctx.user.id], 'invite', {});
    return { data: { ok: true } };
  });

  // Annuler une invitation envoyee (n'importe quel membre de la carte)
  router.delete('/api/invitations/:id', async (ctx) => {
    requireAuth(ctx.user);
    const inv = await db.prepare('SELECT * FROM invitations WHERE id = ?').get(id(ctx.params.id));
    if (!inv) throw new HttpError(404, 'Invitation introuvable');
    await requireMember(ctx.user, inv.map_id);
    if (inv.status !== 'pending') throw new HttpError(410, 'Cette invitation a déjà été traitée');
    await db.prepare("UPDATE invitations SET status = 'cancelled', responded_at = ? WHERE id = ?").run(now(), inv.id);
    sendToUsers([inv.invitee_id], 'invite', {});
    await notifyMap(inv.map_id, { kind: 'invite', origin: ctx.clientId });
    return { data: { ok: true } };
  });
}
