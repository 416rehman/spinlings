// Claude Code's auto-update for this mod (SPEC 32): the registry is found only beside an installed copy, only the
// spinlings entry's flag is read from it, Claude Code's update pass is held exactly where 2.1.319 holds it, and the
// band's offer keeps to its limits.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { ASK, autoUpdateOf, mayAsk, readAsk, registryFolder, registryPath, updatesHeldBy } from '../../plugin/hooks/client/autoupdate.ts'

const DAY = 86_400_000

it('finds the registry four folders above an installed copy, and nowhere else', () => {
  assert.equal(registryPath('/home/a/.claude/plugins/cache/spinlings/spinlings/0.2.16'), '/home/a/.claude/plugins/known_marketplaces.json')
  assert.equal(registryPath('/home/a/.claude/plugins/cache/spinlings/spinlings/0.2.16/'), '/home/a/.claude/plugins/known_marketplaces.json')
  assert.equal(registryPath('C:\\Users\\a\\.claude\\plugins\\cache\\spinlings\\spinlings\\20bfb0c61f52-5e689e2b'), 'C:\\Users\\a\\.claude\\plugins\\known_marketplaces.json')
  assert.equal(registryPath('C:/Users/a/.claude/plugins/cache/spinlings/spinlings/0.3.0'), 'C:/Users/a/.claude/plugins/known_marketplaces.json')
  for (const root of [
    'D:\\projects\\spinlings\\plugin', '/work/spinlings/plugin', '/a/plugins/cache/other/spinlings/0.2.16', '/a/plugins/cache/spinlings/other/0.2.16',
    '/a/plugins/x/spinlings/spinlings/0.2.16', '/a/stuff/cache/spinlings/spinlings/0.2.16', '/a/plugins/cache/spinlings/spinlings/..',
    '/a/../plugins/cache/spinlings/spinlings/1.0.0', 'plugins/cache/spinlings/spinlings/1', '', 42, null, undefined, 'x'.repeat(2000),
  ]) assert.equal(registryPath(root), null, String(root).slice(0, 80))
})

it('names the folder that holds the registry, in the separators of the copy\'s own path, and only where it finds the registry', () => {
  assert.equal(registryFolder('/home/a/.claude/plugins/cache/spinlings/spinlings/0.2.16/'), '/home/a/.claude/plugins')
  assert.equal(registryFolder('C:\\Users\\a\\.claude\\plugins\\cache\\spinlings\\spinlings\\0.3.0'), 'C:\\Users\\a\\.claude\\plugins')
  for (const root of ['/work/spinlings/plugin', '/a/plugins/cache/spinlings/spinlings/..', '', null]) assert.equal(registryFolder(root), null, String(root))
})

it('reads only the spinlings entry\'s autoUpdate flag: true is on, no flag off, false off by choice, anything else unknown', () => {
  assert.equal(autoUpdateOf(JSON.stringify({ spinlings: { autoUpdate: true, installLocation: '/x' }, other: {} })), 'on')
  assert.equal(autoUpdateOf(JSON.stringify({ spinlings: { autoUpdate: false } })), 'off-chosen')
  assert.equal(autoUpdateOf(JSON.stringify({ spinlings: { source: { source: 'git' } } })), 'off')
  for (const junk of ['true', null, 1, {}]) assert.equal(autoUpdateOf(JSON.stringify({ spinlings: { autoUpdate: junk } })), 'unknown', JSON.stringify(junk))
  assert.equal(autoUpdateOf(JSON.stringify({ other: { autoUpdate: true } })), 'unknown')
  for (const text of [null, undefined, '', 'not json', '[]', 'null', '{"spinlings":[]}', '{"spinlings":null}']) assert.equal(autoUpdateOf(text), 'unknown', String(text))
})

it('offers at most three times, a week after Not now, a day after no answer, and never after Don\'t ask again', () => {
  const now = 1_000 * DAY
  const fresh = readAsk(undefined)
  assert.deepEqual(fresh, { asks: 0, until: 0, never: false })
  assert.equal(mayAsk('off', false, fresh, now), true)
  assert.equal(mayAsk('on', true, fresh, now), false)
  assert.equal(mayAsk('unknown', false, fresh, now), false)
  assert.equal(mayAsk('off-chosen', false, fresh, now), false, 'turned off on purpose: never asked')
  assert.equal(mayAsk('off-chosen', true, fresh, now), false)
  assert.equal(mayAsk('off', false, fresh, now, true), false, 'held: the setting could not run')
  assert.equal(mayAsk('unknown', true, fresh, now, true), false)
  assert.equal(mayAsk('unknown', true, fresh, now), true)
  assert.equal(mayAsk(undefined, true, fresh, now), false)
  assert.equal(mayAsk('off', false, { asks: 1, until: now + ASK.laterMs, never: false }, now + 6 * DAY), false)
  assert.equal(mayAsk('off', false, { asks: 1, until: now + ASK.laterMs, never: false }, now + 7 * DAY), true)
  assert.equal(mayAsk('off', false, { asks: 3, until: 0, never: false }, now), false)
  assert.equal(mayAsk('off', false, { asks: 1, until: 0, never: true }, now), false)
  assert.equal(ASK.unansweredMs, DAY)
  assert.deepEqual(readAsk({ asks: 99, until: -5, never: 'yes' }), { asks: 3, until: 0, never: false })
  assert.deepEqual(readAsk([1, 2]), fresh)
})

it('holds Claude Code\'s update pass exactly where 2.1.319 skips it, reading each variable as yes or no only', () => {
  assert.equal(updatesHeldBy({}), false)
  for (const yes of ['1', 'true', 'TRUE', ' yes ', 'on']) {
    assert.equal(updatesHeldBy({ DISABLE_UPDATES: yes }), true, yes)
    assert.equal(updatesHeldBy({ DISABLE_AUTOUPDATER: yes }), true, yes)
  }
  for (const no of ['0', 'false', 'no', 'off', '', 'maybe']) {
    assert.equal(updatesHeldBy({ DISABLE_UPDATES: no }), false, no)
    assert.equal(updatesHeldBy({ DISABLE_AUTOUPDATER: no }), false, no)
  }
  // any value at all, as Claude Code reads it (even 0); an empty one is unset
  assert.equal(updatesHeldBy({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0' }), true)
  assert.equal(updatesHeldBy({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '' }), false)
  // FORCE_AUTOUPDATE_PLUGINS wins over everything
  assert.equal(updatesHeldBy({ DISABLE_UPDATES: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', FORCE_AUTOUPDATE_PLUGINS: '1' }), false)
  assert.equal(updatesHeldBy({ DISABLE_UPDATES: '1', FORCE_AUTOUPDATE_PLUGINS: '0' }), true)
  // a host app (the desktop) sets DISABLE_AUTOUPDATER for Claude Code's own updates: plugins still update there
  assert.equal(updatesHeldBy({ CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST: '1' }), false)
  assert.equal(updatesHeldBy({ CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST: '1', DISABLE_AUTOUPDATER: '1' }), false)
  assert.equal(updatesHeldBy({ CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST: '1', DISABLE_UPDATES: '1' }), true)
  assert.equal(updatesHeldBy({ CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'x' }), true)
})
