// Every figure the docs quote, checked against the numbers the game plays by: ECONOMY, the round pace, the season
// length, the join limits and the retention sweep. A tuning change that leaves a doc behind fails here, and so does a
// claim whose wording moved: find the new sentence and point its phrase at it. `#` in a phrase stands for one number.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ROUND_MS } from '../../plugin/hooks/client/game.ts'
import { chargeSpacingMs, ECONOMY as E } from '../../plugin/hooks/core/economy.ts'
import { SEASON_MS } from '../../plugin/hooks/core/world.ts'
import type { Rarity } from '../../plugin/hooks/core/types.ts'
import { KEEP_DAYS } from '../../server/src/game/retention.ts'
import { JOIN_LIMITS } from '../../server/src/ratelimit.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(ROOT + path, 'utf8').replace(/\r\n/g, '\n')

const { battle: B, wild: W, packs: P, trade: Tr, gift: G, fusion: F, traits: T, levels: L, stats: S, daily: D } = E
const sec = (ms: number) => ms / 1000
const min = (ms: number) => ms / 60_000
const hours = (ms: number) => ms / 3_600_000
const days = (ms: number) => ms / 86_400_000
/** a chance as a percentage */
const pct = (p: number) => Math.round(p * 100)
/** a multiplier as the percentage it adds or takes away */
const gain = (x: number) => Math.round(Math.abs(x - 1) * 100)
const oneIn = (p: number) => Math.round(1 / p)
const weights = (xs: readonly (readonly [unknown, number])[]) => xs.map(([, w]) => w)
const byRarity = (r: Record<Rarity, number>) => [r.common, r.rare, r.epic, r.legendary]

type Claim = [phrase: string, ...expected: number[]]

const NUM = String.raw`(\d+(?:\.\d+)?)`
const pattern = (phrase: string) => new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('#', NUM), 'g')

const CLAIMS: Record<string, Claim[]> = {
  'docs/how-to-play.md': [
    ["Once Claude's main turn has run for # seconds, each further # seconds has a #% chance of an encounter, at most once every # minutes",
      sec(B.encounterAfterMs), sec(B.encounterEveryMs), pct(B.encounterChance), min(B.wildSpacingMs)],
    ["A wild team has 1 to # creatures, common #%, rare #% and epic #%, within # level of your team's average",
      Math.max(...W.size.map(([n]) => n)), ...weights(W.rarity), W.levelSpread],
    ['Your very first encounter is guaranteed at # seconds', sec(B.encounterAfterMs)],
    ['An encounter is a duel #% of the time when an opponent is available and you have not dueled in the last # minutes', pct(B.duelChance), min(B.duelCooldownMs)],
    ['starts a duel any time, at most once every # minutes', min(B.duelSpacingMs)],
    ['After # or more hours without a battle', hours(W.restedMs)],
    ['Every round plays at # seconds', sec(ROUND_MS)],
    ['Your team has # slots', E.teamSize],
    ['# charges make the special ready', B.chargeNeed],
    ['**Perfect** special at #x power', B.perfect],
    ['the occasional critical hit (1 in #)', oneIn(B.critChance)],
    ['After # rounds, the side with more', B.roundLimit],
    ['| Sparks | # (# in a duel) | # | # |', B.sparks.win, B.sparks.duelWin, B.sparks.draw, B.sparks.loss],
    ['| XP for each card that fought | # | # | # |', B.xp.win, B.xp.draw, B.xp.loss],
    ['#% chance to keep one of the creatures you beat (#% on Wild Bloom)', pct(B.catchChance), pct(B.wildBloomCatchChance)],
    ['#% chance of a bounty', pct(B.bountyChance)],
    ['A card that faints is tired for # minutes', min(B.tiredMs)],
    ['the rarest is picked for you after # seconds', sec(B.catchAutoPickMs)],
    ['you get # sparks and a notice', B.defenseSparks],
    ['**Rating** starts at #', E.rating.start],
    ['Only the first # finished duels between the same two players in any # hours', B.pairLimit, hours(B.pairWindowMs)],
    ['settled automatically after # minutes', min(B.abandonMs)],
    ['was around in the last # days, and never one of your last # opponents', days(E.rating.seenWithinMs), E.rating.recentOpponents],
    ['with the usual # minutes between duels. A revenge win pays # extra sparks', min(B.duelSpacingMs), B.revengeBonus],
    ['creatures of that family fight #% harder there', gain(B.arena)],
    ['**Flurry**: two hits at #x each', E.specials.flurry],
    ['**Couplet**: a #x hit, then heal #% of max HP', E.specials.couplet, pct(E.specials.coupletHeal)],
    ['**Crescendo**: a #x hit', E.specials.crescendo],
    ['**Twist**: a #x hit', E.specials.twist],
    ['A winning matchup hits for #x, a losing one for #x', B.typeStrong, B.typeWeak],
    ['a #% chance of a tiny hat', pct(E.cosmetics.trinket)],
    ['four values from 0 to # that nudge hp, attack, defense and speed by up to #% either way',
      Math.round((2 * (1 - S.geneBase)) / S.genePerPoint), gain(S.geneBase)],
    ['**Shiny** cards (1 in #)', oneIn(E.shiny.chance)],
    ['rolled at 1 in # on any card', oneIn(E.foil.chance)],
    ['| Swift | +#% speed |', gain(T.swift)],
    ['| Thick Hide | Takes #% less damage |', gain(T.thickHide)],
    ['| Lucky Star | Critical hits at 1 in # instead of 1 in # |', oneIn(B.luckyCritChance), oneIn(B.critChance)],
    ['| Quick Charge | Special ready after # normal attack instead of # |', B.chargeNeed - 1, B.chargeNeed],
    ['| Glass Heart | +#% attack, −#% hp |', gain(T.glassAtk), gain(T.glassHp)],
    ['| Regrowth | Heals #% of max HP', pct(T.regrowth)],
    ['| Underdog | +#% attack while below #% HP |', gain(T.underdog), pct(T.underdogBelow)],
    ['| Ambush | +#% damage', gain(T.ambush)],
    ['| Moonlit | Specials heal it for #% of the damage', pct(T.moonlit)],
    ['| Showoff | Specials deal #% more |', gain(T.showoff)],
    ['the next ally gets +#% defense', gain(T.guardian)],
    ['| Sleepy | −#% speed, +#% hp |', gain(T.sleepySpd), gain(T.sleepyHp)],
    ['| Homebody | Its arena bonus is #x instead of #x |', B.homebodyArena, B.arena],
    ['Cards level from 1 to #; the next level needs # × the current level in XP', L.max, L.xpPerLevel],
    ['evolves on its own at level # and again at level #', ...L.evolveAt],
    ['Stage 2 is #% stronger than stage 1', gain(S.stageMult[1])],
    ['stage 3 is #% stronger', gain(S.stageMult[2])],
    ['**Starters** begin at level #, # XP short of level #', E.starter.level, L.xpPerLevel * E.starter.level - E.starter.xp, L.evolveAt[0]],
    ['About 1 wild encounter in #', oneIn(W.mythicChance)],
    ['A pack holds # card', P.size],
    ['| # | #% | #% | #% | #% |', 1, ...weights(P.odds)],
    ['shiny (1 in #) and foil (1 in #) on its own', oneIn(E.shiny.chance), oneIn(E.foil.chance)],
    ['Every # minutes that Claude Code is open', P.presenceMinutes],
    ['Charges are at least # minutes apart (# minutes beyond # charges in any # hours',
      min(chargeSpacingMs(0)), min(chargeSpacingMs(P.fastCharges)), P.fastCharges, 24],
    ['You can hold # unopened packs', P.bank],
    ['every #rd win in a row', E.streak.every],
    ['buying them for # sparks each', P.buyCost],
    ['a #% chance of one tier up', pct(F.tierUp)],
    ['otherwise it rolls 1 in #', oneIn(E.foil.chance)],
    ['Costs # sparks (# on Fusion Fair days)', F.cost, F.fairCost],
    ['#, #, # or # sparks for common, rare, epic or legendary', ...byRarity(E.craft)],
    ['**Recycle** a card for #, #, # or # sparks by rarity', ...byRarity(E.recycle)],
    ['foil pays #x', E.recycleFoil],
    ['well under the # sparks a pack costs', P.buyCost],
    ['Offer 1 to # of your cards for 0 to # of theirs', Tr.maxGive, Tr.maxGet],
    ['the offer expires after # hours', hours(Tr.expiryMs)],
    ['up to # offers waiting at once', Tr.openOutgoing],
    ['until someone buys it, you take it back, or # days pass', days(E.market.ttlMs)],
    ['Each species shows its last # sale prices', E.market.recentSales],
    ['You can have up to # cards on the market at once', E.market.open],
    ['by their handle, with the usual # minutes between duels', min(B.duelSpacingMs)],
    ['Only the first # duels between the same two players in any # hours move rating or count toward duel stats', B.pairLimit, hours(B.pairWindowMs)],
    ['**wishlist** of up to # species. The board shows up to # matches', E.wishlistMax, E.boardMatches],
    ['A non-player trader with # deals each UTC day', E.trader.deals],
    ['valid for # days', days(G.ttlMs)],
    ['Unclaimed gifts come back to you after # days', days(G.ttlMs)],
    ['finished # battles on # different days', G.bonusBattles, G.bonusDays],
    ['You can have # gifts waiting at once, and a player can try # claim codes an hour', G.open, G.claimsPerHour],
    ['| A battle | # to # (see Results) |', B.sparks.loss, B.sparks.duelWin],
    ['| A failed attack on your team | # (the first # duels between the same two players in any # hours) |', B.defenseSparks, B.pairLimit, hours(B.pairWindowMs)],
    ['| Your first visit of the UTC day | # |', E.sparks.dailyHello],
    ['| A revenge win | # extra |', B.revengeBonus],
    ['| Recycling a card | # / # / # / # by rarity', ...byRarity(E.recycle)],
    ['| Craft a current-season species | # / # / # / # by rarity |', ...byRarity(E.craft)],
    ['| An extra pack | # |', P.buyCost],
    ['| Fusion | # (# on Fusion Fair days) |', F.cost, F.fairCost],
    ['New players start with # sparks', E.sparks.start],
    ['Every #rd consecutive win pays a streak pack', E.streak.every],
    ['Pebble from #, Brook from #, Grove from #, Peak from # and Star from #', ...E.leagues.map(l => l.min)],
    ['# for Pebble, # for Brook, # for Grove, # for Peak and # for Star', ...E.leagues.map(l => l.seasonPacks)],
    ['**Seasons** last # days', days(SEASON_MS)],
    ['your rating moves halfway back toward #', E.rating.start],
    ['| Haiku Day | Haiku creatures are #% faster |', gain(D.haikuSpd)],
    ['| Sonnet Day | Sonnet creatures heal #% each round |', pct(D.sonnetHeal)],
    ['| Opus Day | Opus creatures hit #% harder |', gain(D.opusAtk)],
    ['| Long Day | Battles run to # rounds |', B.longDayRoundLimit],
    ['| Gentle Day | All damage is #% lower |', gain(D.gentle)],
    ['| Wild Bloom | Catches succeed #% of the time |', pct(B.wildBloomCatchChance)],
    ['| Shiny Hour | From #:00 to #:00 UTC, shinies are 1 in # |', E.shiny.hourStartUtc, E.shiny.hourStartUtc + 1, oneIn(E.shiny.hourChance)],
    ['| Fusion Fair | Fusion costs # sparks |', F.fairCost],
    ['turns up in #% of wild slots', pct(W.featured)],
    ['leading #% of wild encounters', pct(W.roamerChance)],
  ],
  'README.md': [
    ["Once Claude's main turn has run for # seconds, each further # seconds has a #% chance that something rustles in the band, at most once every # minutes",
      sec(B.encounterAfterMs), sec(B.encounterEveryMs), pct(B.encounterChance), min(B.wildSpacingMs)],
    ['Your first encounter comes at # seconds', sec(B.encounterAfterMs)],
    ['Every round takes # seconds', sec(ROUND_MS)],
    ['Perfect special at #x power', B.perfect],
    ['A card that faints is tired for # minutes', min(B.tiredMs)],
    ['at least # minutes between wild encounters and # minutes between duels', min(B.wildSpacingMs), min(B.duelSpacingMs)],
    ['About 1 wild encounter in #', oneIn(W.mythicChance)],
    ['You can hold # unopened packs', P.bank],
    ['Duels start at least # minutes apart', min(B.duelSpacingMs)],
    ['After # or more hours without a battle', hours(W.restedMs)],
    ['offers # deals a day', E.trader.deals],
    ['Start a duel now (at most one every # minutes)', min(B.duelSpacingMs)],
    ['two welcome packs and # sparks', E.sparks.start],
    ['At least # minutes apart (# beyond # in any # hours) and at most # unopened',
      min(chargeSpacingMs(0)), min(chargeSpacingMs(P.fastCharges)), P.fastCharges, 24, P.bank],
    ['a wild battle starts at least # minutes after the last', min(B.wildSpacingMs)],
    ['none finishes faster than # seconds a round', sec(B.minRoundMs)],
    ['an unfinished battle is settled after # minutes', min(B.abandonMs)],
    ['at most # joins an hour and # a day per network', JOIN_LIMITS.joins.hour, JOIN_LIMITS.joins.day],
    ['Only the first # finished duels between the same two players in any # hours', B.pairLimit, hours(B.pairWindowMs)],
    ['per # minutes of presence', P.presenceMinutes],
    ['a break of # hours or more', hours(W.restedMs)],
    ['battles are deleted # days after they end', KEEP_DAYS.settledBattles],
    ['Old notices, offers and gifts are deleted after # days', KEEP_DAYS.notices],
    ['`/spin privacy` shows the last # requests the mod sent', E.client.privacyLog],
    ['responses over # KB are rejected', E.client.responseMaxBytes / 1024],
  ],
  'PRIVACY.md': [
    ['the last # requests the mod sent', E.client.privacyLog],
    ['`/spin privacy` shows the last # request paths', E.client.privacyLog],
    ['the day it was last used | Deleted after # days unused', days(E.server.sessionIdleMs)],
    ['| A passkey page in progress | Deleted after # minutes', min(E.server.pollTtlMs)],
    ['While open, then deleted # days after they end', KEEP_DAYS.resolvedListings],
    ['never who sold or bought | Deleted after # days |', KEEP_DAYS.marketSales],
    ['such as the #-minute battle window', min(B.abandonMs)],
    ['| Deleted # days after the battle is settled', KEEP_DAYS.settledBattles],
    ['| Notices (defense results, trade and gift news) | Deleted after # days |', KEEP_DAYS.notices],
    ['| Deleted # days after they end |', KEEP_DAYS.resolvedOffers],
    ['(each expires after # days unused)', days(E.server.sessionIdleMs)],
    ['# days after its last use', days(E.server.sessionIdleMs)],
  ],
  'SECURITY.md': [
    ['the #-pack bank', P.bank],
    ['rejects responses over # KB', E.client.responseMaxBytes / 1024],
  ],
}

describe('the numbers the docs quote are the ones the game plays by', () => {
  for (const [file, claims] of Object.entries(CLAIMS)) {
    it(file, () => {
      const text = read(file)
      for (const [phrase, ...expected] of claims) {
        const found = [...text.matchAll(pattern(phrase))]
        assert.ok(found.length > 0, `${file} no longer says "${phrase}" (reworded? point the phrase at the new sentence)`)
        for (const m of found) assert.deepEqual(m.slice(1).map(Number), expected, `${file}: "${m[0]}" should say ${expected.join(', ')}`)
      }
    })
  }

  it('a pack recycles for well under its price, as how-to-play.md says', () => {
    const value = (odds: readonly (readonly [Rarity, number])[]) => odds.reduce((sum, [r, w]) =>
      sum + (w / 100) * E.recycle[r] * (1 + E.shiny.chance * (E.recycleShiny - 1)) * (r === 'legendary' ? E.recycleFoil : 1 + E.foil.chance * (E.recycleFoil - 1)), 0)
    const pack = P.size * value(P.odds)
    assert.ok(pack < 0.75 * P.buyCost, `a pack recycles for about ${pack.toFixed(0)} sparks against its ${P.buyCost}`)
  })
})
