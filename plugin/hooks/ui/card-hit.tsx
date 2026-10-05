// Pointer coordinates stay in this renderer. A completed left click posts only null to the owning pane.
import type { ClientModule } from 'claude-code'

type Held = { x: number; y: number; intent: string } | null
const CardHit: ClientModule<{ intent: string }, Held> = (props, surface) => {
  const { Box } = surface.elements
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
  return <Box width="100%" height="100%" />
}

export default CardHit
