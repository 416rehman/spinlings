// Who found what (SPEC 13, 18, 20.1, 20.7, 20.8): a Mythic's card never stores its finder's handle.
// The server keeps the finder by id and names them as the card is read, only while the handle is
// the one they found it under, so a reroll or a deletion leaves nothing that puts an old handle
// beside a new one. First discoveries never name anyone on the public pages.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { seasonOf, utcDay } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { base32 } from '../../server/src/game/ctx.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { DAY, MINUTE, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { envOf, snapshot, trust } from './social-helpers.ts'

const handle = (p: Player) => p.me.player.handle
const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const page = async (s: Server, path: string) => (await s.request('GET', path, { client: null })).text()
const nameOf = (c: Card) => c.form!.names[2]!

/** A Mythic left to catch after p's won wild battle, caught through the real endpoint. */
async function catchMythic(s: Server, p: Player, seed: string): Promise<Card> {
  const wild = toBattleCard({ ...generateMythic({ seed, dna: 7, now: s.now() }), id: 'wild-0' })
  const id = base32(crypto.getRandomValues(new Uint8Array(16)))
  await s.db.batch([stmt(
    `INSERT INTO battles (id, attacker_id, kind, state, setup, opponent, started_at, settled, result, catch_options, catch_until)
     VALUES (?, ?, 'wild', 'settled', '{}', '{}', ?, ?, 'win', ?, ?)`,
    id, p.id, s.now(), utcDay(s.now()), JSON.stringify([wild]), s.now() + MINUTE,
  )])
  return (await p.call('catchCreature', { battleId: id, index: 0 })).card
}

const giveTo = (s: Server, c: Card, to: Player) => s.db.batch([stmt('UPDATE cards SET owner_id = ? WHERE id = ?', to.id, c.id)])
const finderOf = async (p: Player, c: Card) => (await p.call('cards')).cards.find(x => x.id === c.id)!.form!.discoveredBy

/** Tables whose rows mention `needle`. */
async function holding(s: Server, needle: string): Promise<string[]> {
  return Object.entries(await snapshot(s.db)).filter(([, rows]) => rows.some(r => r.includes(needle))).map(([t]) => t)
}

describe('a Mythic names its finder only as it is read (SPEC 18, 20.1)', () => {
  it('keeps no handle on the card: the finder is kept by id and named from the Mythics list', async () => {
    const s = server()
    const f = await s.join()
    const m = await catchMythic(s, f, 'aa11aa11')
    assert.equal(m.form?.discoveredBy, handle(f), 'the catch answer names the finder')
    const row = await s.db.get<{ form: string }>('SELECT * FROM cards WHERE id = ?', m.id)
    assert.ok(!JSON.stringify(row).includes(handle(f)), 'no handle anywhere on the card row')
    assert.equal(JSON.parse(row!.form).discoveredBy, undefined)
    assert.deepEqual(await s.db.get('SELECT finder_id, handle FROM mythics WHERE card_id = ?', m.id), { finder_id: f.id, handle: handle(f) })
    assert.equal(await finderOf(f, m), handle(f))

    // a finder's name the card itself claims is never believed, nor stored
    const claimed = generateMythic({ seed: 'bb22bb22', dna: 1, now: s.now(), origin: 'catch' })
    const { cards, stmts } = await mintCards(envOf(s), f.id, [{ ...claimed, form: { ...claimed.form!, discoveredBy: 'brave-wren-41' } }])
    await s.db.batch(stmts)
    assert.equal(cards[0]!.form!.discoveredBy, handle(f))
    assert.deepEqual(await holding(s, 'brave-wren-41'), [])
  })

  it('names the finder wherever the card lives now: its new owner, a profile and its page', async () => {
    const s = server()
    const [f, o, x] = [await s.join(), await s.join(), await s.join()]
    await trust(s, f, o)
    const m = await catchMythic(s, f, 'cc33cc33')
    const { gift } = await f.call('gift', { cardId: m.id })
    await o.call('claim', { code: gift.code })
    s.tick(DAY + MINUTE) // past the trade lock, so it can be listed
    await o.call('setForTrade', { cardId: m.id, forTrade: true })
    assert.equal(await finderOf(o, m), handle(f))
    const listed = (await x.call('profile', { handle: handle(o) })).forTrade.find(c => c.id === m.id)
    assert.equal(listed?.form?.discoveredBy, handle(f))
    const text = textOf(await page(s, `/c/${m.id}`))
    assert.ok(text.includes(`Discovered by ${handle(f)}`))
    assert.ok(!text.includes(handle(o)), 'never its owner')
  })

  it('after a reroll it names nobody: no card, copy, list or page shows the old handle beside the new one', async () => {
    const s = server()
    const [f, o] = [await s.join(), await s.join()]
    const kept = await catchMythic(s, f, 'dd44dd44')
    const given = await catchMythic(s, f, 'ee55ee55')
    await giveTo(s, given, o)
    const old = handle(f)
    const before = (await o.call('me')).player.cardsVersion
    const { handle: renamed } = await f.call('rerollHandle', {})

    assert.ok((await o.call('me')).player.cardsVersion > before, "the new owner's collection moves, so the stamp goes")
    assert.equal(await finderOf(o, given), undefined)
    assert.equal(await finderOf(f, kept), undefined)
    const landing = await page(s, '/')
    for (const c of [kept, given]) {
      assert.ok(textOf(landing).includes(`${nameOf(c)} found by a trainer`))
      const card = await page(s, `/c/${c.id}`)
      assert.ok(textOf(card).includes('Discovered by a trainer'))
      for (const html of [landing, card]) assert.ok(!html.includes(old) && !html.includes(renamed))
    }
    assert.deepEqual(await holding(s, old), ['retired_handles'], 'only the retired list remembers the old handle')
    assert.deepEqual(await holding(s, renamed), ['players'])

    // a Mythic found under the new handle is credited to it, and the old finds stay unnamed
    const later = await catchMythic(s, f, 'ff66ff66')
    assert.equal(later.form?.discoveredBy, renamed)
    const text = textOf(await page(s, '/'))
    assert.ok(text.includes(`${nameOf(later)} found by ${renamed}`))
    assert.ok(text.includes(`${nameOf(kept)} found by a trainer`) && !text.includes(old))
  })

  it('after a deletion it names nobody, and nothing left says who found it', async () => {
    const s = server()
    const [f, o] = [await s.join(), await s.join()]
    const m = await catchMythic(s, f, 'gg77gg77')
    await giveTo(s, m, o)
    const before = (await o.call('me')).player.cardsVersion
    await f.call('deleteMe')
    assert.ok((await o.call('me')).player.cardsVersion > before)
    assert.equal(await finderOf(o, m), undefined)
    assert.ok(textOf(await page(s, `/c/${m.id}`)).includes('Discovered by a trainer'))
    assert.ok(textOf(await page(s, '/')).includes(`${nameOf(m)} found by a trainer`))
    assert.deepEqual(await s.db.get('SELECT finder_id, handle FROM mythics WHERE card_id = ?', m.id), { finder_id: null, handle: null })
    assert.deepEqual(await holding(s, f.id), [])
    assert.deepEqual(await holding(s, handle(f)), ['retired_handles'])
  })

  it('never shows a name stored before this rule, nor one that is no longer the finder\'s, and wipes it on a reroll', async () => {
    const s = server()
    const f = await s.join()
    const m = await catchMythic(s, f, 'hh88hh88')
    await s.db.batch([stmt(`UPDATE cards SET form = json_set(form, '$.discoveredBy', 'stale-otter-99') WHERE id = ?`, m.id)])
    assert.equal(await finderOf(f, m), handle(f))
    assert.ok(!(await page(s, `/c/${m.id}`)).includes('stale-otter-99'))
    // the list's handle is not the finder's any more: nobody is named
    await s.db.batch([stmt(`UPDATE mythics SET handle = 'stale-otter-99' WHERE card_id = ?`, m.id)])
    assert.equal(await finderOf(f, m), undefined)
    for (const path of ['/', `/c/${m.id}`]) assert.ok(!(await page(s, path)).includes('stale-otter-99'), path)
    await f.call('rerollHandle', {})
    assert.deepEqual(await holding(s, 'stale-otter-99'), [])
  })
})

describe('first discoveries on the public pages (SPEC 13, 20.8)', () => {
  it('say "first found by a trainer", never by whom, so a deletion changes nothing a visitor sees', async () => {
    const s = server()
    const [f, o] = [await s.join(), await s.join()]
    const found = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(r => r.species))
    const species = seasonSpecies(seasonOf(s.now())).find(x => !x.legendary && !found.has(x.id))!
    const fresh = mintCard({ species, rarity: 'common', shiny: false, dna: 11, origin: 'pack', now: s.now() })
    const { cards, stmts } = await mintCards(envOf(s), f.id, [fresh])
    await s.db.batch(stmts)
    const first = cards[0]!
    assert.equal(first.firstFind, true)
    // o holds it now and lists it, so o's profile shows it too
    await s.db.batch([stmt('UPDATE cards SET owner_id = ?, for_trade = 1 WHERE id = ?', o.id, first.id)])

    const gallery = (html: string) => html.slice(html.indexOf('id="season"'), html.indexOf('id="mythics"'))
    const card = await page(s, `/c/${first.id}`)
    const landing = gallery(await page(s, '/'))
    assert.ok(textOf(card).includes('First found by a trainer'))
    assert.ok(textOf(await page(s, `/u/${handle(o)}`)).includes('First discovered'))
    assert.ok(textOf(landing).includes(` ${species.names[0]} `), 'the species shows as found')
    for (const html of [card, landing]) assert.ok(!html.includes(handle(f)) && !html.includes(handle(o)))

    await f.call('deleteMe')
    assert.equal((await s.db.get<{ player_id: string | null }>('SELECT player_id FROM firsts WHERE species = ?', species.id))!.player_id, null)
    assert.equal(await page(s, `/c/${first.id}`), card)
    assert.equal(gallery(await page(s, '/')), landing)
  })
})
