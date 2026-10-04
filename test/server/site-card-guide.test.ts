import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import { CARD_HELP, cardMove, geneChange } from '../../server/src/card-guide.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { lots } from '../../server/src/pages-boards.ts'
import { cardDetails, cardFace, cardTile, CSS, fullCard } from '../../server/src/pages-html.ts'
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
    assert.match(tile, /<\/a><details class="card-inspect"><summary>Card details/)
    assert.doesNotMatch(cardFace(c).__html, /cf-combat|card-inspect/, 'the landing face stays compact unless opted in')
  })

  it('explains traits, family, special, individual genes and damage with native tap/keyboard disclosures and pointer previews', async () => {
    const { c } = await example()
    c.traits = ['quickCharge', 'glassHeart']
    c.genes = [0, 5, 10, 15]
    const detail = cardDetails(c).__html
    for (const phrase of ['HP', 'Attack', 'Defense', 'Speed', 'Quick Charge', 'Glass Heart', 'Sonnet matchups', 'Couplet', 'Gene quality', 'How damage works']) {
      assert.ok(flat(detail).includes(phrase), phrase)
    }
    assert.match(detail, /<summary>Quick Charge<span class="help-peek" aria-hidden="true">/)
    assert.ok(detail.includes(`<p class="help-body">${TRAITS.quickCharge.text}</p>`), 'help is real disclosure content, not a title attribute')
    assert.match(detail, /HP gene<\/dt><dd>0\/15 · -12%/)
    assert.match(detail, /Speed gene<\/dt><dd>15\/15 · \+12%/)
    assert.match(detail, /Fires automatically after 1 normal attack\./)
    assert.match(detail, /There is no single fixed damage value for a card/)
    assert.match(CSS, /summary:focus-visible \.help-peek\{display:block\}/)
    assert.match(CSS, /@media \(hover:hover\)\{\.card-help[^}]*summary:hover \.help-peek\{display:block\}/)
    assert.doesNotMatch(detail, /\son[a-z]+\s*=|<script\b|javascript:/i)
  })

  it('keeps the same inspection in a market listing, outside its link and after the price', async () => {
    const { c } = await example()
    const markup = lots([{ id: 'guide-listing', seller: 'moss-trainer', card: c, price: 123, want: undefined }]).__html
    assert.match(markup, /<dl class="cf-combat">/)
    assert.match(markup, /<b>123<\/b>/)
    assert.ok(markup.indexOf('card-inspect') > markup.indexOf('ptagbox'))
    assert.doesNotMatch(markup.match(/<a class="cardlink"[^>]*>([\s\S]*?)<\/a>/)![1]!, /<details\b/)
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
    assert.match(page, /<summary>Four genes<span class="help-peek"/)
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
