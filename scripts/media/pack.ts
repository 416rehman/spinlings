// Recording (b): a pack opening in the pane, paced exactly as the ceremony driver paces it. The package tears open,
// two backs wait in the strip (one pulsing gold), each flips with its own build-up, the legendary turns the border
// gold, and the summary's tiles carry the foil sheen. Then a look at the legendary itself: its card, foil sweeping.
import type { Card } from '../../plugin/hooks/core/types.ts'
import type { GameState, Reveal } from '../../plugin/hooks/client/types.ts'
import { camera, recording } from './scenes.ts'
import type { Shot } from './scenes.ts'
import type { Theme } from './view.ts'
import { dayWith, mediaWorld } from './world.ts'

const { TIMING } = await import('../../plugin/hooks/client/anim.ts')
const { layers } = await import('../../plugin/hooks/ui/ceremony.tsx')

export function packWorld() {
  const now = dayWith('calm')
  const w = mediaWorld(now, 'spinlings/media/pack')
  const cards: Card[] = [
    w.mint('opus', 2, 'common', {}, 1, 2718281828),
    w.mint('opus', 8, 'legendary', { foil: true }, 1, 3141592653),
  ]
  const reveal: Reveal = {
    id: 'media-pack', kind: 'pack', family: 'opus', cards, packs: [], fresh: cards.map(c => c.species),
    album: { before: 12, after: 14, total: 36 },
  }
  const base: GameState = {
    ...w.base,
    me: { ...w.base.me!, packs: [{ id: 'media-pack-2', family: 'haiku', source: 'charge', day: w.base.me!.player.joinedDay }] },
    cards: [...w.base.cards, ...cards],
    signals: { ...w.base.signals, working: false },
  }
  return { w, now, cards, reveal, base }
}

export function packShots(): Shot[] {
  const { now, cards, reveal, base } = packWorld()
  const at = (flipped: number): GameState => ({ ...base, reveal, pane: { ...base.pane, tab: 'cards', stack: [{ kind: 'reveal' }], flipped } })
  const cam = camera(now, { pane: true, working: false })
  const wait = (c: Card) => TIMING.buildup[c.rarity] + TIMING.pause + TIMING.flip[c.rarity]
  const held = (c: Card) => TIMING.hold[c.rarity] + layers(c, reveal) * TIMING.layer
  cam.shoot(at(0), TIMING.tearDelay + TIMING.tear + wait(cards[0]!), { key: 'o' })
  for (let i = 1; i < cards.length; i++) cam.shoot(at(i), held(cards[i - 1]!) + wait(cards[i]!))
  cam.shoot(at(cards.length), held(cards.at(-1)!) + 3200)
  // a look at the legendary: its full card, the foil sweeping across
  cam.shoot({ ...base, pane: { ...base.pane, tab: 'cards', stack: [{ kind: 'card', cardId: cards[1]!.id }] } }, 5200, { key: 'Tab' })
  return cam.shots
}

export function packSvg(t: Theme): string {
  return recording(packShots(), t, 650, 'Spinlings: a pack opening in the pane, a legendary glowing gold before it flips')
}
