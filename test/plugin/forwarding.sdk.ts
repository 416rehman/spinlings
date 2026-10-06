// Spinlings never observes agent creation or changes its outcome. These injected engine events perform no actual
// prompt/model/tool work; an approved result and a refusal reach the caller without changing the game or networking.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, AgentSpawnResult } from 'claude-code'
import { engine } from './engine.ts'
import { NOW } from './fixtures.ts'

test('agent spawn bypasses Spinlings and preserves engine decisions without cosmetic state changes', { timeoutMs: 60_000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const allowed = { model: 'claude-haiku-4-5', agentId: 'approved-fixture-agent' } as const
  const denied = { deny: 'Fixture engine refused this agent' } as const
  const forwarded: AgentSpawnInput[] = []
  const gameWrites: string[] = []
  on('state.set', (_$, event, next) => {
    gameWrites.push(event.key)
    return next(event)
  })
  let release!: (result: AgentSpawnResult) => void
  let entered!: () => void
  const reachedEngine = new Promise<void>(resolve => { entered = resolve })
  on('agent.spawn', (_$, event) => {
    forwarded.push(event)
    if (forwarded.length > 1) return denied
    entered()
    return new Promise<AgentSpawnResult>(resolve => { release = resolve })
  })
  const w = engine(on)
  const args: AgentSpawnInput = {
    tool_use_id: 'fixture-spawn', prompt: 'Fixture prompt stays unchanged', description: 'Fixture subagent',
    subagentType: 'general-purpose', model: 'haiku', provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-sonnet-4-6', background: false, fork: false,
  }
  let completed = false
  const spawning = $.agent.spawn(args).then(result => { completed = true; return result })
  await reachedEngine
  expect(forwarded).toHaveLength(1)
  expect(forwarded[0]).toEqual(args)
  expect(completed).toBe(false)
  release(allowed)
  expect(await spawning).toEqual(allowed)
  expect(completed).toBe(true)
  expect(gameWrites).toEqual([])
  expect(await $.agent.spawn(args)).toEqual(denied)
  expect(forwarded).toHaveLength(2)
  expect(forwarded[1]).toEqual(args)
  expect(gameWrites).toEqual([])
  expect(w.requests).toEqual([])
  expect(w.opened).toBe(0)
})
