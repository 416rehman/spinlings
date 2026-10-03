import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MotionClock } from '../../server/static/client/clock.ts'
import { server } from './scaffold-helpers.ts'

describe('the demo battle pause', () => {
  it('offers an accessible pause button beside the demo, with no scripts needed for the static battle', async () => {
    const s = server()
    const page = await (await s.request('GET', '/', { client: null })).text()
    assert.match(page, /<button[^>]*type="button"[^>]*data-pause[^>]*aria-label="Pause demo battle"[^>]*aria-pressed="false"[^>]*hidden>Ⅱ Pause<\/button>/)
    assert.match(page, /class="band" data-band role="img" aria-label=/)
  })

  it('freezes battle time and every remaining wait through repeated pauses, including new work queued while paused', async t => {
    let wall = 0
    t.mock.method(performance, 'now', () => wall)
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const elapse = async (ms: number) => { wall += ms; t.mock.timers.tick(ms); await Promise.resolve() }
    const clock = new MotionClock(), steps: string[] = []
    void clock.wait(1000).then(() => steps.push('round'))
    await elapse(400)
    clock.pause()
    const at = clock.now()
    void clock.wait(250).then(() => steps.push('catch'))
    await elapse(60_000)
    assert.equal(clock.now(), at)
    assert.deepEqual(steps, [])
    clock.resume()
    await elapse(249)
    assert.deepEqual(steps, [])
    await elapse(1)
    assert.deepEqual(steps, ['catch'])
    clock.pause()
    await elapse(10_000)
    clock.resume()
    await elapse(349)
    assert.deepEqual(steps, ['catch'])
    await elapse(1)
    assert.deepEqual(steps, ['catch', 'round'])
    assert.equal(clock.now(), 1000)
  })

  it('holds animation frames and cancels future effects without advancing them during a pause', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const clock = new MotionClock()
    const calls: string[] = []
    const animation = { finished: new Promise(() => {}), pause: () => calls.push('pause'), play: () => calls.push('play') } as unknown as Animation
    clock.track(animation)
    clock.pause()
    const cancel = clock.after(() => calls.push('effect'), 100)
    t.mock.timers.tick(5000)
    assert.deepEqual(calls, ['pause'])
    cancel()
    clock.resume()
    t.mock.timers.tick(1000)
    assert.deepEqual(calls, ['pause', 'play'])
  })
})
