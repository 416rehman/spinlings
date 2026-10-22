import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { NewCard, Species } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { SITE_CSP } from '../../server/src/pages-html.ts'
import { PUBLIC_MYTHICS_PAGE } from '../../server/src/public-collection.ts'
import { DAY, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const flat = (markup: string) => markup.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const body = (markup: string) => markup.slice(markup.indexOf('<main'), markup.indexOf('</main>'))
const get = async (s: Server, path: string) => {
  const response = await s.request('GET', path, { client: null })
  return { response, markup: await response.text() }
}
async function mint(s: Server, p: Player, card: NewCard) {
  const result = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, p.id, [card])
  await s.db.batch(result.stmts)
  return result.cards[0]!
}
async function findSpecies(s: Server, p: Player, species: Species) {
  const card = await mint(s, p, {
    ...mintFor(species.family, species.legendary ? 'legendary' : 'common', rngFromSeed('catalogue-species'), s.now(), 'trader', false),
    species: species.id, season: species.season, family: species.family,
  })
  assert.equal(card.firstFind, true, 'the fixture mints a species that nobody has found yet')
  return card
}
async function unfoundSonnet(s: Server): Promise<Species> {
  const found = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts WHERE season = ?', 1)).map(row => row.species))
  const species = seasonSpecies(1).find(form => form.family === 'sonnet' && !form.legendary && !found.has(form.id))
  assert.ok(species, 'a regular Sonnet species remains outside the random starter teams')
  return species
}
const mythic = (s: Server, p: Player, seed: string) => mint(s, p, generateMythic({ seed, dna: 7, now: s.now(), origin: 'catch' }))

describe('the public species and Mythic catalogue', () => {
  it('makes every season icon a real art-inclusive link, with a Mythic shelf beside the lanterns', async () => {
    const s = server()
    const { markup } = await get(s, '/')
    const entries = [...markup.matchAll(/<a class="nook" href="(\/species\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    assert.equal(entries.length, 36)
    assert.equal(new Set(entries.map(match => match[1])).size, 36)
    for (const match of entries) {
      assert.match(match[2]!, /<svg/)
      assert.doesNotMatch(match[0], /tabindex="-1"|<button|role="button"/)
    }
    assert.match(markup, /href="\/mythics">Meet the Mythics/)
    assert.match(markup, /href="\/mythics">Browse the Mythic catalogue/)
    assert.match(markup, /class="lstring"/, 'the original lantern scene stays in place')
  })

  it('shows a found species and its three real frozen forms, combat guide and linked first discoverer', async () => {
    const s = server(), p = await s.join('haiku')
    const species = await unfoundSonnet(s)
    await findSpecies(s, p, species)
    const { response, markup } = await get(s, `/species/${species.id}`), content = body(markup)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-security-policy'), SITE_CSP)
    for (const name of species.names) assert.ok(flat(content).includes(name), name)
    assert.equal((content.match(/class="evolution"/g) ?? []).length, 3)
    for (const label of ['Stage 1 of 3', 'Stage 2 of 3', 'Stage 3 of 3', 'Base stats', 'Sonnet matchups', 'Couplet', 'How damage works']) assert.ok(flat(content).includes(label), label)
    assert.match(content, new RegExp(`First discovered by <a href="/u/${p.me.player.handle}">${p.me.player.handle}</a>`))
    assert.ok(flat(content).includes('before genes'))
    for (const value of [p.id, p.token]) assert.ok(!markup.includes(value), 'no private player/session identifier')
    assert.doesNotMatch(content, /mintedAt|raisedIn|tiredUntil|lockedUntil|owner_id|player_id/)
  })

  it('keeps unfound species anonymous and colourless, and rejects unknown or future species before storing them', async () => {
    const s = server(), form = seasonSpecies(1).find(species => species.id === 's1-fable-4')!
    const { response, markup } = await get(s, `/species/${form.id}`), content = body(markup)
    assert.equal(response.status, 200)
    assert.ok(flat(content).includes('Not yet discovered'))
    assert.match(content, /<svg class="shd"/)
    assert.doesNotMatch(content, /class="spr|class="evolution"|class="species-stats"|First discovered by/)
    for (const name of form.names) assert.ok(!content.includes(name), 'no unrevealed form name')
    for (const path of ['/species/not-a-species', '/species/s1-haiku-9', '/species/s2-haiku-0', '/species/s9999-fable-8']) assert.equal((await get(s, path)).response.status, 404, path)
    assert.equal(await s.db.get('SELECT season FROM seasons WHERE season > 1'), undefined)
  })

  it('reads past-season forms from the stored catalogue and labels legendaries as one final form', async () => {
    const s = server({ now: T0 + 30 * DAY })
    const stored = JSON.parse(JSON.stringify(seasonSpecies(1))) as Species[]
    const form = stored.find(species => species.id === 's1-sonnet-4')!
    form.names = ['FrozenSprout', 'FrozenTwig', 'FrozenTree']
    form.base = { hp: 47.5, atk: 17.5, def: 13.5, spd: 15.5 }
    await s.db.batch([stmt('INSERT INTO seasons (season, generator, species_json) VALUES (?, ?, ?)', 1, 1, JSON.stringify(stored))])
    const p = await s.join('haiku')
    await findSpecies(s, p, form)
    const { markup } = await get(s, `/species/${form.id}`), content = body(markup)
    for (const name of form.names) assert.ok(flat(content).includes(name))
    assert.match(content, /<dd>47\.5<\/dd>/)
    assert.equal((content.match(/class="evolution"/g) ?? []).length, 3)
    const legendary = stored.find(species => species.id === 's1-opus-8')!
    await findSpecies(s, p, legendary)
    const final = body((await get(s, `/species/${legendary.id}`)).markup)
    assert.equal((final.match(/class="evolution"/g) ?? []).length, 1)
    assert.ok(flat(final).includes('always in its final form'))
    assert.doesNotMatch(final, /Stage 1 of 3|Stage 2 of 3/)
  })

  it('keeps discovery credit on the original finder, clears old identities on rename, and never credits a new owner', async () => {
    const s = server(), first = await s.join('haiku'), next = await s.join('opus')
    const form = await unfoundSonnet(s)
    const c = await findSpecies(s, first, form), initialHandle = first.me.player.handle
    await s.db.batch([stmt('UPDATE cards SET owner_id = ? WHERE id = ?', next.id, c.id)])
    const before = body((await get(s, `/species/${form.id}`)).markup)
    assert.match(before, new RegExp(`href="/u/${initialHandle}"`))
    assert.doesNotMatch(before, new RegExp(`href="/u/${next.me.player.handle}"`))
    await s.db.batch([stmt('UPDATE players SET handle = ? WHERE id = ?', 'new-catalogue-trainer', first.id)])
    const after = body((await get(s, `/species/${form.id}`)).markup)
    assert.ok(flat(after).includes('First discovered by a trainer'))
    assert.ok(!after.includes(initialHandle) && !after.includes('new-catalogue-trainer'))
  })

  it('shows the real caught Mythic card, its full-card link and finder; historical cards have honest text without fake art', async () => {
    const s = server(), p = await s.join('haiku')
    const current = await mythic(s, p, 'catalogue-mythic-current'), old = await mythic(s, p, 'catalogue-mythic-old')
    await s.db.batch([stmt('DELETE FROM cards WHERE id = ?', old.id)])
    const { response, markup } = await get(s, '/mythics'), content = body(markup)
    assert.equal(response.status, 200)
    assert.ok(flat(content).includes('2 Mythics found'))
    assert.equal((content.match(/<symbol id="lantern"/g) ?? []).length, 1, 'one shared lantern drawing per page')
    assert.equal((content.match(/class="mythic-lamp"/g) ?? []).length, 2, 'each discovery keeps its lit lantern, including a missing original')
    assert.doesNotMatch(content, /mythic-lamp unlit/)
    assert.ok(content.includes(`href="/c/${current.id}"`))
    assert.ok(content.includes(`href="/u/${p.me.player.handle}"`))
    assert.ok(flat(content).includes(current.form!.names[2]))
    const history = content.match(/<li class="mythic-history">([\s\S]*?)<\/li>/)![1]!
    assert.ok(flat(history).includes(old.form!.names[2]))
    assert.ok(flat(history).includes('The original card is no longer available.'))
    assert.doesNotMatch(history, /<svg class="spr|class="cf|href="\/c\//)
    for (const value of [p.id, p.token]) assert.ok(!markup.includes(value))
    assert.doesNotMatch(content, /mintedAt|raisedIn|tiredUntil|lockedUntil|owner_id|player_id/)
  })

  it('leaves the empty catalogue lantern dark without revealing a future discovery', async () => {
    const s = server(), p = await s.join('haiku')
    const future = await mythic(s, p, 'future-not-discovered')
    await s.db.batch([stmt('UPDATE mythics SET day = ? WHERE card_id = ?', '2099-01-01', future.id)])
    const { response, markup } = await get(s, '/mythics'), content = body(markup)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(flat(content).includes('0 Mythics found'))
    assert.match(content, /class="mythic-lamp unlit" aria-hidden="true"/)
    assert.doesNotMatch(content, /class="mythic-lamp"|class="spr|href="\/c\//)
    assert.ok(!content.includes(future.form!.names[2]))
  })

  it('paginates Mythics without dropping records and rejects malformed filters', async () => {
    const s = server(), p = await s.join('haiku')
    for (let i = 0; i < PUBLIC_MYTHICS_PAGE + 2; i++) await mythic(s, p, `catalogue-mythic-${i}`)
    const first = body((await get(s, '/mythics')).markup)
    assert.equal((first.match(/<li class="tile">/g) ?? []).length, PUBLIC_MYTHICS_PAGE)
    assert.equal((first.match(/class="mythic-lamp"/g) ?? []).length, PUBLIC_MYTHICS_PAGE)
    const more = first.match(/href="(\/mythics\?after=[^\"]+)"/)
    assert.ok(more)
    const last = body((await get(s, more[1]!)).markup)
    assert.equal((last.match(/<li class="tile">/g) ?? []).length, 2)
    assert.equal((last.match(/class="mythic-lamp"/g) ?? []).length, 2)
    assert.ok(last.includes('Back to first page'))
    assert.doesNotMatch(last, />More Mythics/)
    assert.equal((await get(s, '/mythics?after=bad')).response.status, 400)
    assert.equal((await get(s, '/mythics?owner=anything')).response.status, 400)
  })
})
