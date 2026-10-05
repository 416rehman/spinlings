import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCommand } from '../../plugin/hooks/client/commands.ts'

test('world commands distinguish the chooser, default online, offline and one community address', () => {
  assert.deepEqual(parseCommand('world'), { kind: 'world', world: null })
  assert.deepEqual(parseCommand(' WORLD ONLINE '), { kind: 'world', world: 'online' })
  assert.deepEqual(parseCommand('world offline'), { kind: 'world', world: 'offline' })
  assert.deepEqual(parseCommand('world https://cats.example/play'), { kind: 'world', world: null, url: 'https://cats.example/play' })
  assert.deepEqual(parseCommand('world http://localhost:8787'), { kind: 'world', world: null, url: 'http://localhost:8787' })
  assert.equal(parseCommand('world online extra').kind, 'help')
  assert.equal(parseCommand('world https://cats.example second').kind, 'help')
})

test('released server aliases remain accepted without changing their parsed values', () => {
  assert.deepEqual(parseCommand('server'), { kind: 'server', url: null })
  assert.deepEqual(parseCommand('server default'), { kind: 'server', url: 'default' })
  assert.deepEqual(parseCommand('server https://cats.example'), { kind: 'server', url: 'https://cats.example' })
})
