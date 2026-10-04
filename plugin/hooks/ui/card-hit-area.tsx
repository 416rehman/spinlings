// A desktop tile's pointer region forwards only a current, local control. Its ordinary Button keeps the keys.
import type { RenderElement } from 'claude-code'
import type { El } from '../client/types.ts'
import { registerCardHit } from './card-hit-state.ts'

export function cardHit(el: El, enabled: boolean, key: string, on: (() => unknown) | undefined, button = `${key}-pick`, intent = key, target?: string): RenderElement | null {
  if (!enabled || !on || !el.Client) return null
  const hit = `${key}${target ? `-${target}` : ''}-hit`
  registerCardHit(hit, button, intent, on)
  return <el.Box position="absolute" top={0} bottom={0} left={0} right={0}>
    <el.Client key={hit} module="./card-hit.tsx" props={{ intent }} width="100%" height="100%" />
  </el.Box>
}
