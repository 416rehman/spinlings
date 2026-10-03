// The battles' touch step (see touch.ts): settle a battle this player attacked or defended that was
// left unfinished for 10 minutes, with no inputs (SPEC 5, Abandoned battles). One per touch, so two
// settles never race each other's guards inside one batch; the next request takes the next. The
// season-end grant and soft reset run in touch.ts's seasonTurn, guarded by the player's version.
import type { PlayerCtx } from '../app.ts'
import type { Stmt } from '../db.ts'
import { autoSettle, abandonedBattleOf, closeBattle } from './battles.ts'
import { bumpPlayer, loadPlayer, playerGuard } from './ctx.ts'

export async function battleTouch(ctx: PlayerCtx): Promise<Stmt[]> {
  const b = await abandonedBattleOf(ctx.db, ctx.player.id, ctx.now)
  if (!b) return []
  if (b.attacker_id === ctx.player.id) return autoSettle(ctx, b, ctx.player)
  // the caller defended: the attacker's row is written too, so it is guarded and bumped here
  const attacker = await loadPlayer(ctx.db, b.attacker_id)
  if (!attacker) return closeBattle(b, ctx.now)
  return [playerGuard(attacker), ...(await autoSettle(ctx, b, attacker)), bumpPlayer(attacker.id)]
}
