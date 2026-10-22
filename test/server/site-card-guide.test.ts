import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import { CARD_HELP, cardMove, geneChange } from '../../server/src/card-guide.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { lots } from '../../server/src/pages-boards.ts'
import { cardFace, cardTile, CSS, fullCard } from '../../server/src/pages-html.ts'
import { server } from './scaffold-helpers.ts'

const flat = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

async function example() {
  const s = server()
  const p = await s.join('haiku')
  const { cards, stmts } = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, p.id, [
    mintFor('sonnet', 'epic', rngFromSeed('card-guide'), s.now(), 'trader', false),
  ])
  await s.db.batch(stmts)
  return { s, p, c: cards[0]! }
}

describe('public card inspection', () => {
  it('shows authoritative combat numbers and named traits on tiles without nesting controls in a link', async () => {
    const { c } = await example()
    c.stats = { hp: 82, atk: 29, def: 26, spd: 34 }
    c.traits = ['quickCharge', 'glassHeart']
    const tile = cardTile(c, { link: true }).__html
    const linked = tile.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)![1]!
    assert.match(linked, /<dl class="cf-combat">/)
    for (const [name, value] of [['HP', 82], ['Attack', 29], ['Defense', 26], ['Speed', 34]]) {
      assert.ok(linked.includes(`<dt>${name}</dt><dd>${value}</dd>`))
    }
    assert.match(linked, /Quick Charge, Glass Heart/)
    assert.doesNotMatch(linked, /<(?:details|summary|button)\b/, 'the card link contains only its static face')
    assert.match(tile, new RegExp(`<a class="cardlink" href="/c/${c.id}"`))
    assert.doesNotMatch(tile, /<(?:details|summary|button)\b|Card details/, 'browse cards open their own page instead of expanding a panel')
    assert.doesNotMatch(cardFace(c).__html, /cf-combat|card-inspect/, 'the landing face stays compact unless opted in')
  })

  it('separates visible card abilities and genes from optional battle rules', async () => {
    const { c } = await example()
    c.traits = ['quickCharge', 'glassHeart']
    c.genes = [0, 5, 10, 15]
    const detail = fullCard(c).__html
    for (const phrase of ['HP', 'Attack', 'Defense', 'Speed', 'Quick Charge', 'Glass Heart', 'Sonnet matchups', 'Couplet', 'Gene quality', 'How damage works']) {
      assert.ok(flat(detail).includes(phrase), phrase)
    }
    assert.match(detail, /<section class="card-section card-stats"><h2>Combat stats<\/h2>\s*<dl class="stats">/)
    const abilities = detail.match(/<section class="card-section card-abilities"><h2>Abilities<\/h2>([\s\S]*?)<div class="card-properties">/)![1]!
    assert.match(abilities, /<section class="special-move"><h3>Special move<\/h3><p class="move-name">Couplet<\/p>/)
    assert.match(abilities, /Fires automatically after 1 normal attack\./)
    assert.match(abilities, /<section class="passive-traits"><h3>Passive traits<\/h3><dl>/)
    for (const t of ['quickCharge', 'glassHeart'] as const) {
      assert.ok(abilities.includes(`<dt>${TRAITS[t].name}</dt><dd>${TRAITS[t].text}</dd>`), 'named traits and their effects are always readable')
    }
    assert.doesNotMatch(abilities, /<(?:details|summary)\b|How damage works|About genes/, 'card-specific abilities are not hidden among help controls')

    const genes = detail.match(/<section class="card-section card-genetics"><h2>Genes<\/h2>([\s\S]*?)<\/section>/)![1]!
    assert.match(genes, /HP gene<\/dt><dd>0\/15 · -12%/)
    assert.match(genes, /Speed gene<\/dt><dd>15\/15 · \+12%/)
    assert.equal((genes.match(/ gene<\/dt>/g) ?? []).length, 4)
    assert.match(genes, /<\/dl><details class="card-help"><summary>About genes<span class="help-peek"/)
    assert.ok(genes.includes(`<p class="help-body">${CARD_HELP.genes}</p>`), 'gene rules remain available through native tap and keyboard disclosure')

    const guide = detail.match(/<section class="card-section card-guide"><h2>Battle guide<\/h2>([\s\S]*?)<\/details><\/section>/)![1]!
    assert.match(guide, /^<details class="card-reference"><summary>Matchups &amp; damage<\/summary>/, 'general battle help starts collapsed')
    assert.match(guide, /<h3>Sonnet matchups<\/h3>/)
    assert.match(guide, /<h3>How damage works<\/h3>/)
    assert.match(guide, /There is no single fixed damage value for a card/)
    assert.doesNotMatch(guide, /Quick Charge|Glass Heart|Couplet|About genes|<details\b[^>]*\bopen\b/)
    assert.match(CSS, /summary:focus-visible \.help-peek\{display:block\}/)
    assert.match(CSS, /@media \(hover:hover\)\{\.card-help[^}]*summary:hover \.help-peek\{display:block\}/)
    assert.doesNotMatch(detail, /\son[a-z]+\s*=|<script\b|javascript:/i)
  })

  it('shows only a card\'s actual finishes in a separate cosmetic appearance section', async () => {
    const { c } = await example()
    for (const [shiny, foil] of [[false, false], [true, false], [false, true], [true, true]]) {
      const detail = fullCard({ ...c, shiny, foil }).__html
      const appearance = detail.match(/<section class="card-section card-appearance">([\s\S]*?)<\/section>/)?.[1]
      if (!shiny && !foil) {
        assert.equal(appearance, undefined, 'plain cards have no irrelevant finish section')
        continue
      }
      assert.ok(appearance)
      assert.match(appearance, /<h2>Appearance <span class="cosmetic-label">Cosmetic<\/span><\/h2>/)
      assert.match(appearance, /Finishes do not change combat stats\./)
      assert.equal((appearance.match(/<dt>/g) ?? []).length, Number(shiny) + Number(foil))
      assert.equal(appearance.includes('Shiny</dt>'), shiny)
      assert.equal(appearance.includes('Foil</dt>'), foil)
      if (shiny) assert.match(appearance, /Different creature colours and sparkle\./)
      if (foil) assert.match(appearance, /A rainbow card frame\./)
      assert.doesNotMatch(appearance, /<(?:details|summary)\b|How damage works|matchups/)
    }
  })

  it('presents Mimic as the actual special and leaves no empty traits section', async () => {
    const { c } = await example()
    c.traits = ['mimic', 'quickCharge']
    const detail = fullCard(c).__html
    const special = detail.match(/<section class="special-move">([\s\S]*?)<\/section>/)![1]!
    assert.match(special, /<h3>Special move<\/h3><p class="move-name">Mimic special<\/p>/)
    assert.match(special, /Copies the special of the opposing active creature’s family\./)
    assert.match(special, /Fires automatically after 1 normal attack\./)
    assert.doesNotMatch(special, /Couplet|<(?:details|summary)\b/)
    assert.doesNotMatch(fullCard({ ...c, traits: [] }).__html, /class="passive-traits"|<h3>Passive traits<\/h3>/)
  })

  it('keeps market listings compact with the numbers in the face and the price outside the card link', async () => {
    const { c } = await example()
    const markup = lots([{ id: 'guide-listing', seller: 'moss-trainer', card: c, price: 123, want: undefined }]).__html
    assert.match(markup, /<dl class="cf-combat">/)
    assert.match(markup, /<b>123<\/b>/)
    assert.match(markup, /<\/a>\s*<div class="ptagbox">/)
    assert.doesNotMatch(markup, /<(?:details|summary|button)\b|Card details/)
    const linked = markup.match(/<a class="cardlink"[^>]*>([\s\S]*?)<\/a>/)![1]!
    assert.match(linked, /<div class="cf-art">/)
    assert.doesNotMatch(linked, /ptagbox|<a\b/)
  })

  it('keeps the existing public page art and strict headers without exposing owner or activity data', async () => {
    const { s, p, c } = await example()
    const response = await s.request('GET', `/c/${c.id}`, { client: null })
    const page = await response.text()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'none'/)
    assert.match(page, /<div class="bigcard" data-bigcard><div class="cf big"/)
    assert.match(page, /<div class="plaque">/)
    assert.match(page, /<summary>Attack<span class="help-peek"/)
    assert.match(page, /<summary>About genes<span class="help-peek"/)
    for (const privateValue of [p.id, p.token]) assert.ok(!page.includes(privateValue))
    assert.doesNotMatch(page, /raisedIn|mintedAt|tiredUntil|lockedUntil|Authorization/)
    assert.doesNotMatch(fullCard({ ...c, raisedIn: 'opus' }).__html, /raised|Opus matchups/)
  })

  it('uses the actual gene and special rules, including quick charge and opposing-family Mimic', () => {
    assert.equal(geneChange(0), `${Math.round((ECONOMY.stats.geneBase - 1) * 1000) / 10}%`)
    assert.equal(geneChange(15), '+12%')
    assert.match(cardMove({ family: 'haiku', traits: [] }).text, /2 hits at 0\.9× normal-hit power each/)
    assert.match(cardMove({ family: 'sonnet', traits: [] }).text, /heals 15% of its maximum HP/)
    assert.match(cardMove({ family: 'opus', traits: [] }).text, /2\.1× normal-hit power/)
    assert.match(cardMove({ family: 'fable', traits: [] }).text, /Always counts as super effective/)
    assert.match(cardMove({ family: 'opus', traits: ['mimic', 'quickCharge'] }).text, /opposing active creature’s family.*after 1 normal attack/)
    assert.equal(cardMove({ family: 'opus', traits: ['mimic'] }).name, 'Mimic special')
    assert.equal(CARD_HELP.families.haiku.special.name, 'Flurry')
    assert.match(CARD_HELP.damage, /Attack × Attack ÷ \(Attack \+ the target’s Defense\)/)
  })
})
