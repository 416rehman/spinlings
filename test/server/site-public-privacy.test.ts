import assert from 'node:assert/strict'
import { it } from 'node:test'
import { server } from './scaffold-helpers.ts'

it('the privacy page explains public collections, discovery identity and retained private fields', async () => {
  const s = server()
  const response = await s.request('GET', '/privacy', { client: null })
  assert.equal(response.status, 200)
  const markup = await response.text()
  const text = markup.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  for (const required of [
    'complete held-card inventory, with filters and pages',
    'public handles and saved-team lead creatures, alphabetically or by handle search',
    'Hiding from leaderboards hides your stats, not your profile, inventory, directory entry or discovery credit',
    'actual caught creatures, their names and a link to the discoverer',
    'without invented artwork',
    'Uncaught encounters and unused named Mythics stay unrevealed',
    'Trading a card never transfers discovery credit',
    'Your old and new names are never linked',
    'An older find stays anonymous when its original handle cannot be established safely',
    'Discovery dates and times are never shown',
    'Your inventory is current',
    'Card families can also hint at the model families you tend to use',
    'midnight snapshots',
    'Your unopened packs, charging progress, sparks, devices and passkeys stay private',
    'never in a URL, cookie or public page',
  ]) assert.ok(text.includes(required), `policy discloses: ${required}`)
  assert.match(markup, /href="\/players"/)
  assert.doesNotMatch(text, /It never says which one|No new game fields or public player information are stored/)
  assert.doesNotMatch(markup, /<script\b/i)
  const policy = new Map(response.headers.get('content-security-policy')!.split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/)
    return [name, values.join(' ')]
  }))
  assert.equal(policy.get('connect-src') ?? policy.get('default-src'), "'none'")
})
