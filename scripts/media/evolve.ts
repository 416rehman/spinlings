// Recording (c): one creature through its three stages. In the band, the creature and a white silhouette of its
// next stage trade places faster and faster, a flash, then the new stage with its stat gains: the starter Sootwolf
// grows into Sootaptor at level 4 and into Sootinotaur at level 8. The album's page for the species ends it, the
// whole line side by side.
import type { Card } from '../../plugin/hooks/core/types.ts'
import { cardName } from '../../plugin/hooks/core/cards.ts'
import { EVOLVE_SHOW, TIMING } from '../../plugin/hooks/client/battleview.ts'
import type { GameState } from '../../plugin/hooks/client/types.ts'
import { camera, recording } from './scenes.ts'
import type { Shot } from './scenes.ts'
import type { Theme } from './view.ts'
import { dayWith, mediaWorld } from './world.ts'

export function evolveShots(): Shot[] {
  const now = dayWith('calm')
  const w = mediaWorld(now)
  const lead = w.starters[0]!
  const cam = camera(now)
  const grown = (stage: 1 | 2 | 3, level: number): Card => ({ ...lead, stage, level, xp: 0, ...(stage > 1 ? { raisedIn: 'opus' as const } : {}) })
  const grow = (stage: 2 | 3, level: number) => {
    const card = grown(stage, level)
    const state: GameState = {
      ...w.base,
      cards: w.base.cards.map(c => (c.id === lead.id ? card : c)),
      moments: [{ kind: 'evolve', id: `evolve:${stage}`, cardId: lead.id, from: cardName({ ...lead, stage: (stage - 1) as 1 | 2 }), to: cardName(card), stage, until: cam.now() + EVOLVE_SHOW }],
    }
    cam.shoot(state, TIMING.evolve)
    cam.shoot(state, 3400)
  }
  cam.shoot(w.base, 1200)
  grow(2, 4)
  cam.shoot(w.base, 1200)
  grow(3, 8)
  const album: GameState = {
    ...w.base,
    cards: w.base.cards.map(c => (c.id === lead.id ? grown(3, 8) : c)),
    pane: { ...w.base.pane, tab: 'album', stack: [{ kind: 'species', speciesId: lead.species }] },
  }
  cam.shoot(album, 4800, { pane: true, working: false })
  return cam.shots
}

export function evolveSvg(t: Theme): string {
  return recording(evolveShots(), t, 600, 'Spinlings: a creature evolving through its three stages')
}
