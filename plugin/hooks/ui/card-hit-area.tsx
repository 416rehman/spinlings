// A desktop tile's pointer region forwards only a current, local control. Its ordinary Button keeps the keys.
import type { RenderElement } from 'claude-code'
import type { El } from '../client/types.ts'
import { registerCardHit } from './card-hit-state.ts'

export function cardHit(el: El, enabled: boolean, key: string, on: (() => unknown) | undefined, button = `${key}-pick`, intent = key, target?: string): RenderElement | null {
  if (!enabled || !on || !el.Client) return null
  const hit = `${key}${target ? `-${target}` : ''}-hit`
  registerCardHit(hit, button, intent, on)
  return <el.Box position="absolute" top={0} bottom={0} left={0} right={0} flexDirection="column">
    <el.Client key={hit} module="./card-hit.tsx" props={{ intent }} width="100%" flexGrow={1} />
  </el.Box>
}

/** Cover only noninteractive content: the native name/action Button remains a separate, usable control. */
export function cardHitRegion(el: El, content: RenderElement, enabled: boolean, key: string, on: (() => unknown) | undefined,
  button: string, intent: string, target?: string): RenderElement {
  const hit = cardHit(el, enabled, key, on, button, intent, target)
  if (!hit) return content
  return <el.Box position="relative" flexDirection="column">{content}{hit}</el.Box>
}
