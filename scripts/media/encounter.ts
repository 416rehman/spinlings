// Recording (a): a wild encounter while Claude works, from the band's own views. Something rustles (an epic's
// shimmering outline), a wild Snowelkie appears with its FIRST IN THE WORLD? tease, four rounds play with a Perfect
// special on the round 1 Now! shows, and the catch ceremony wobbles three beats before Gotcha!
import type { Card } from '../../plugin/hooks/core/types.ts'
import { paceMs, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { TIMING, catchPreMs, revealHoldMs, roundPlan, rustleMs } from '../../plugin/hooks/client/battleview.ts'
import type { Battle, GameState, Outcome } from '../../plugin/hooks/client/types.ts'
import { camera, recording } from './scenes.ts'
import type { Shot } from './scenes.ts'
import type { Theme } from './view.ts'
import { battleOf, dayWith, mediaWorld } from './world.ts'

export function encounterShots(): Shot[] {
  const now = dayWith('wildBloom')
  const w = mediaWorld(now)
  // an epic stage-2 sonnet: Sootwolf's Crescendo is super effective on it, so the Perfect press lands big
  const wild = w.mint('sonnet', 3, 'epic', {}, 4, 147926868)
  const base: GameState = { ...w.base, me: { ...w.base.me!, player: { ...w.base.me!.player, streak: 1 } } }
  const fresh = battleOf(w, { seed: 'enc-sonnet-3-13', defender: [wild], first: true })
  const pace = paceMs(base.signals.effort)
  const cam = camera(now)
  const at = (b: Battle | null): GameState => ({ ...base, battle: b })

  cam.shoot(at(null), 1600)
  cam.shoot(at({ ...fresh, phase: 'rustle' }), rustleMs(fresh))
  cam.shoot(at({ ...fresh, phase: 'reveal' }), TIMING.reveal + revealHoldMs(fresh))
  const quiet = simulateBattle(fresh.setup as never, [])
  const press = quiet.rounds.find(r => r.actions.some(a => a.side === 'a' && a.move === 'special'))!.round
  const log = simulateBattle(fresh.setup as never, [press])
  for (let r = 1; r <= log.rounds.length; r++) {
    const b: Battle = { ...fresh, phase: 'fight', shown: r - 1, inputs: r > press ? [press] : [] }
    const plan = roundPlan(b, r > press ? log : quiet, r, pace)!
    if (r !== press) { cam.shoot(at(b), plan.ms); continue }
    // the press lands as the special winds up; the band re-draws and the round plays on with the Perfect numbers
    const special = plan.hits.find(h => h.actor === 'a' && h.action.move === 'special')!
    const tp = Math.max(0, special.at - 2 * TIMING.windup)
    cam.shoot(at(b), tp)
    const pressed: Battle = { ...b, inputs: [press] }
    cam.shoot(at(pressed), roundPlan(pressed, log, r, pace)!.ms - tp, { key: '1' })
  }
  cam.shoot(at({ ...fresh, phase: 'finishing', shown: log.rounds.length, inputs: [press] }), 700)

  const caught = { ...wild, id: 'media-caught', origin: 'catch' } as Card
  const outcome: Outcome = {
    battleId: fresh.id, kind: 'wild', opponent: { kind: 'wild' }, lead: toBattleCard(wild), result: 'win', sparks: ECONOMY.battle.sparks.win,
    rating: 1312, ratingDelta: 0, league: null, perfect: 1, xp: [], catch: { status: 'caught', card: caught }, bounty: null,
    dailyWinPack: false, streak: 2, streakPack: false,
  } as Outcome
  // the catch result is in as the ceremony starts: the band still spins and wobbles before it says so
  const result: GameState = { ...base, moments: [{ kind: 'outcome', id: 'outcome:media', outcome, until: cam.now() + ECONOMY.battle.resultBandMs }] }
  cam.shoot(result, catchPreMs(caught))
  cam.shoot(result, 3600)
  return cam.shots
}

export function encounterSvg(t: Theme): string {
  return recording(encounterShots(), t, 420, 'Spinlings: a wild encounter in the band above the prompt while Claude works')
}
