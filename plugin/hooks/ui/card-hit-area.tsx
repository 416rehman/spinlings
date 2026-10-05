// A desktop tile's pointer region forwards only a current, local control. Its ordinary Button keeps the keys.
import type { RenderElement } from 'claude-code'
import type { El } from '../client/types.ts'
import { cells } from '../client/text.ts'
import { registerCardHit } from './card-hit-state.ts'

type HitSize = { pixels: { width: number; height: number } } | { rows: number }
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function textOf(content: unknown): string {
  if (typeof content === 'string' || typeof content === 'number') return String(content)
  return (content && typeof content === 'object' ? (content as Node).children ?? [] : []).map(textOf).join('')
}

/** Svg is sized in pixels; text and empty slots use their existing row geometry, without guessing a desktop font. */
function sizeOf(content: RenderElement, columns?: number): HitSize {
  const n = content as Node, p = n.props ?? {}
  if (n.type === 'Svg' && typeof p.width === 'number' && typeof p.height === 'number') {
    return { pixels: { width: p.width, height: p.height } }
  }
  if (typeof p.height === 'number' && p.height > 0) return { rows: Math.ceil(p.height) }
  const width = p.wrap === 'wrap' && columns ? columns : Number.MAX_SAFE_INTEGER
  return { rows: textOf(content).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(cells(line) / width)), 0) }
}

export function cardHit(el: El, enabled: boolean, key: string, on: (() => unknown) | undefined, button = `${key}-pick`, intent = key, target?: string, size: HitSize = { rows: 1 }): RenderElement | null {
  if (!enabled || !on || !el.Client) return null
  const hit = `${key}${target ? `-${target}` : ''}-hit`
  registerCardHit(hit, button, intent, on)
  // Native sizes floor to cells; art needs one extra cell behind its clipped region for partial edges.
  const edge = 'pixels' in size ? -1 : 0
  return <el.Box position="absolute" top={0} bottom={edge} left={0} right={edge} flexDirection="column">
    <el.Client key={hit} module="./card-hit.tsx" props={{ intent, size }} width="100%" flexGrow={1} />
  </el.Box>
}

/** Cover only noninteractive content: the native name/action Button remains a separate, usable control. */
export function cardHitRegion(el: El, content: RenderElement, enabled: boolean, key: string, on: (() => unknown) | undefined,
  button: string, intent: string, target?: string, columns?: number): RenderElement {
  const hit = cardHit(el, enabled, key, on, button, intent, target, sizeOf(content, columns))
  if (!hit) return content
  return <el.Box position="relative" flexDirection="column" overflow="hidden">{content}{hit}</el.Box>
}
