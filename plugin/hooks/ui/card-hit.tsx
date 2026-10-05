// Pointer coordinates stay in this renderer. A completed left click posts only null to the owning pane.
import type { ClientModule, RenderElement } from 'claude-code'

type Held = { x: number; y: number; intent: string } | null
type Size = { pixels: { width: number; height: number } } | { rows: number }
const CardHit: ClientModule<{ intent: string; size: Size }, Held> = (props, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    // A host can deliver its first click before reporting size. Positive dimensions still bound captured releases.
    const inside = e.x >= 0 && e.y >= 0 && (surface.columns <= 0 || e.x < surface.columns) && (surface.rows <= 0 || e.y < surface.rows)
    if (e.type === 'down') {
      surface.setState(inside && e.button === 'left' && !e.shift && !e.ctrl && !e.alt ? { x: e.x, y: e.y, intent: props.intent } : null)
    } else if (e.type === 'move' && surface.state && (!inside || Math.abs(e.x - surface.state.x) > 1 || Math.abs(e.y - surface.state.y) > 1)) {
      surface.setState(null)
    } else if (e.type === 'up') {
      const held = surface.state
      surface.setState(null)
      if (held && held.intent === props.intent && inside && e.button === 'left' && !e.shift && !e.ctrl && !e.alt
        && Math.abs(e.x - held.x) <= 1 && Math.abs(e.y - held.y) <= 1) surface.post(null)
    }
  })
  // The host measures this Client's own tree, not the visible sibling it covers. Give it the same intrinsic extent.
  const size = props.size
  // Svg trees validate here, but the surface's element table has no Svg factory; Svg must omit children entirely.
  const spacer: RenderElement = 'pixels' in size
    ? { type: 'Svg', props: {
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.pixels.width} ${size.pixels.height}"/>`,
      alt: '', width: size.pixels.width, height: size.pixels.height,
    } }
    : <Text>{'\n'.repeat(Math.max(1, size.rows) - 1) + ' '}</Text>
  return <Box width="100%" flexDirection="column">{spacer}</Box>
}

export default CardHit
