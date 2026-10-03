/** A local animation timeline: pausing preserves every remaining delay and frame. */
export class MotionClock {
  paused = false
  private held = 0
  private offset = 0
  private timers = new Set<{ at: number; id?: ReturnType<typeof setTimeout>; fire(): void }>()
  private animations = new Set<Animation>()

  now() { return (this.paused ? this.held : performance.now()) - this.offset }

  after(fire: () => void, ms: number): () => void {
    const t = { at: this.now() + ms, fire: () => { this.timers.delete(t); fire() }, id: undefined as ReturnType<typeof setTimeout> | undefined }
    this.timers.add(t)
    if (!this.paused) t.id = setTimeout(t.fire, ms)
    return () => { clearTimeout(t.id); this.timers.delete(t) }
  }

  wait(ms: number) { return new Promise<void>(r => this.after(r, ms)) }

  track(a: Animation): Animation {
    if (this.animations.has(a)) return a
    this.animations.add(a)
    a.finished.then(() => this.animations.delete(a), () => this.animations.delete(a))
    if (this.paused) a.pause()
    return a
  }

  pause() {
    if (this.paused) return
    this.held = performance.now()
    this.paused = true
    for (const t of this.timers) clearTimeout(t.id)
    for (const a of this.animations) a.pause()
  }

  resume() {
    if (!this.paused) return
    this.offset += performance.now() - this.held
    this.paused = false
    for (const t of this.timers) t.id = setTimeout(t.fire, Math.max(0, t.at - this.now()))
    for (const a of this.animations) a.play()
  }
}
