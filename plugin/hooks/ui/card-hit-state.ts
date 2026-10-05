// Only the current pane's local card controls can answer a renderer's null message.
type Pick = { button: string; intent: string; on: () => unknown; fence: number }
const picks = new Map<string, Pick>()
let fence = 0

export function clearCardHits(inactive = false): void {
  picks.clear()
  if (inactive) fence++
}

export function registerCardHit(key: string, button: string, intent: string, on: () => unknown): void {
  picks.set(key, { button, intent, on, fence })
}

export function prepareCardHit(key: string, data: unknown): ((focus: (button: string) => Promise<unknown>) => Promise<void>) | null {
  const pick = data === null ? picks.get(key) : undefined
  if (!pick) return null
  const current = () => {
    const live = picks.get(key)
    return pick.fence === fence && live !== undefined && live.fence === pick.fence
      && live.button === pick.button && live.intent === pick.intent
  }
  return async focus => {
    if (!current()) return
    try { await focus(pick.button) } catch { /* a host may have no focus route */ }
    if (current()) await pick.on()
  }
}
