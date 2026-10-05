// The two reference pages: /odds publishes every rate straight from ECONOMY, so it can never drift
// from the rules (SPEC 15 Transparency), and /privacy is the plain-words version of SPEC 20 and
// PRIVACY.md.
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import type { Rarity } from '../../plugin/hooks/core/types.ts'
import { DAILY_RULES, RULE_INFO } from '../../plugin/hooks/core/world.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { heading, html, PAPER_CSS, raw, REPO } from './pages-html.ts'
import type { Raw } from './pages-html.ts'
import { spriteSvg } from './pages-sprite.ts'
import { regulars } from './pages-world.ts'
import { RARITY_COLOR } from '../../plugin/hooks/ui/tokens.ts'

/** A small pixel picture for an almanac section, from rows of letters. */
function pic(rows: readonly string[], ink: Record<string, string>): Raw {
  const by: Record<string, string> = {}
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (ink[c]) by[c] = (by[c] ?? '') + `M${x} ${y}h1v1h-1z` }))
  return raw(`<svg class="pic" viewBox="0 0 ${rows[0]!.length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${Object.entries(by).map(([c, d]) => `<path fill="${ink[c]}" d="${d}"/>`).join('')}</svg>`)
}
const PICS = {
  pack: pic(['.kkkkkk.', 'kggggggk', 'kgwwwwgk', 'kgwggwgk', 'kgwwwwgk', 'kggggggk', 'kggggggk', '.kkkkkk.'], { k: '#2a1d18', g: '#a874e8', w: '#fffdf5' }),
  tuft: pic(['..1..1..', '.12.121.', '.122222.', '12222221', '22322232', '23222222'], { '1': '#9ed36a', '2': '#5f9f4a', '3': '#3f7a3a' }),
  spark: pic(['...y....', '...y....', '..yyy...', 'yyywyyy.', '..yyy...', '...y....', '...y....'], { y: '#f2b33d', w: '#fffdf5' }),
  egg: pic(['..eee..', '.eeeee.', 'eeeceee', 'eecceee', 'eeeccee', '.eeeee.', '..eee..'], { e: '#e8dcc4', c: '#2a1d18' }),
  lamp: pic(['.sss.', 's.l.s', 's.l.s', '.sss.', '..s..', '..s..', '..s..', '.sss.'], { s: '#2a2433', l: '#f2b33d' }),
  sun: pic(['..y.y..', '.yyyyy.', 'yyyyyyy', '.yyyyy.', 'yyyyyyy', '.yyyyy.', '..y.y..'], { y: '#f2b33d' }),
  wheel: pic(['.hh.ss.', 'hh...ss', 'h.....s', '.......', 'f.....o', 'ff...oo', '.ff.oo.'], { h: '#5fbf8f', s: '#5b8def', o: '#e8744f', f: '#a874e8' }),
}

/** 40 tufts, one glowing: the Mythic rate, drawn. */
function tufts(n: number): Raw {
  return html`<p class="tufts" role="img" aria-label="${`One wild encounter in ${n} is led by a Mythic`}">${Array.from({ length: n }, (_, i) => raw(`<i${i === 23 ? ' class="glow"' : ''}></i>`))}</p>`
}

const E = ECONOMY
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const pct = (x: number) => `${Number((x * 100).toFixed(x * 100 < 1 ? 2 : 1))}%`
const oneIn = (x: number) => `1 in ${Math.round(1 / x)}`
const mins = (ms: number) => `${ms / 60_000} minutes`

/** Weighted odds as percentages of their total. */
const share = <K extends string | number>(rows: readonly (readonly [K, number])[]) => {
  const total = rows.reduce((n, [, w]) => n + w, 0)
  return rows.map(([k, w]) => [k, pct(w / total)] as const)
}

/** A rarity's gem beside its column heading (the word stays: never colour alone). */
const gem = (h: string) => {
  const c = RARITY_COLOR[h.toLowerCase() as Rarity]
  return c ? raw(`<i class="gem" style="--rar:${c}" aria-hidden="true"></i>`) : ''
}

const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]): Raw => html`<div class="tablewrap"><table class="table${head.length > 2 ? ' wide' : ''}">
<thead><tr>${head.map((h, i) => html`<th${i ? html` class="n"` : ''} scope="col">${gem(h)}${h}</th>`)}</tr></thead>
<tbody>${rows.map(r => html`<tr>${r.map((c, i) => (i ? html`<td class="n">${c}</td>` : html`<th scope="row">${c}</th>`))}</tr>`)}</tbody>
</table></div>`

const rarityRow = (label: string, odds: readonly (readonly [Rarity, number])[]) => {
  const p = new Map(share(odds))
  return [label, ...(['common', 'rare', 'epic', 'legendary'] as const).map(r => p.get(r) ?? '0%')]
}

export function oddsBody(): Raw {
  const b = E.battle
  const rested = share(E.wild.restedRarity)
  return html`<article class="paperpage wrap almanac">
<h1>${heading('The almanac')}</h1>
<p class="lede">Every rate in the game. The server rolls everything, with the same odds for every family and every player, and these numbers come straight from the rules it runs.</p>

<h2>${PICS.pack}${heading('Packs')}</h2>
<p>A pack holds ${E.packs.size} card, rolled when you open it, with no guaranteed rarity. A legendary roll gives the pack family's legendary; every other card is one of the family's 8 regular species, picked evenly.</p>
${table(['Card', 'Common', 'Rare', 'Epic', 'Legendary'], [
    rarityRow('Card', E.packs.odds),
  ])}
${table(['Finish', 'Chance per card'], [
    ['Shiny', oneIn(E.shiny.chance)],
    [`Shiny during Shiny Hour (${E.shiny.hourStartUtc}:00 to ${E.shiny.hourStartUtc + 1}:00 UTC on Shiny Hour days)`, oneIn(E.shiny.hourChance)],
    ['Foil (every legendary and Mythic is foil)', oneIn(E.foil.chance)],
    ['A trinket, like a tiny hat or a bow', pct(E.cosmetics.trinket)],
    ["The species' own pattern", pct(E.cosmetics.defaultPattern)],
  ])}

<h2>${PICS.tuft}${heading('Wild encounters')}</h2>
<p>Once Claude's main turn has run ${E.battle.encounterAfterMs / 1000} seconds, every further ${E.battle.encounterEveryMs / 1000} seconds has a ${pct(E.battle.encounterChance)} chance that something rustles, at most once every ${mins(b.wildSpacingMs)}. Your first encounter comes at ${E.battle.encounterAfterMs / 1000} seconds.</p>
${table(['Wild team', 'Chance'], E.wild.size.map(([n, w]) => [`${n} creature${n > 1 ? 's' : ''}`, pct(w / E.wild.size.reduce((t, [, x]) => t + x, 0))]))}
${table(['Each wild creature comes from', 'Chance'], [
    ["Your arena's family", pct(E.wild.arena)],
    ["Today's featured species", pct(E.wild.featured)],
    ['Any family', pct(1 - E.wild.arena - E.wild.featured)],
  ])}
${table(['Its rarity', 'Chance'], share(E.wild.rarity).map(([r, p]) => [cap(r), p] as const))}
${table(['The lead creature', 'Chance'], [
    ['A Mythic, never seen before and never again', oneIn(E.wild.mythicChance)],
    ["Otherwise, this week's roaming legendary", oneIn(E.wild.roamerChance)],
    ...rested.map(([r, p]) => [`After ${E.wild.restedMs / 3_600_000} hours away: ${r}`, p] as const),
  ])}
${tufts(Math.round(1 / E.wild.mythicChance))}
<p>Wild creatures sit within ${E.wild.levelSpread} level of your team's average.</p>

<h2>${PICS.spark}${heading('After a battle')}</h2>
${table(['Result', 'Sparks', 'XP each'], [
    ['Win', `${b.sparks.win} (duel ${b.sparks.duelWin})`, b.xp.win],
    ['Draw', b.sparks.draw, b.xp.draw],
    ['Loss', b.sparks.loss, b.xp.loss],
  ])}
${table(['Roll', 'Chance'], [
    ['Catch after a wild win', pct(b.catchChance)],
    ['Catch on Wild Bloom days', pct(b.wildBloomCatchChance)],
    ['Catch after your first wild win ever', '100%'],
    ['A bounty card after a duel win', pct(b.bountyChance)],
    ['A critical hit', oneIn(b.critChance)],
    ['A critical hit with Lucky Star', oneIn(b.luckyCritChance)],
  ])}
<p>You never lose a card in battle. Your first win each day adds a pack, and every ${E.streak.every}rd win in a row adds a streak pack. A Perfect special, pressed on the round it fires, hits ${b.perfect}x as hard.</p>

<h2>${PICS.sun}${heading('Every card is one of a kind')}</h2>
${table(['Gene or trait', 'Range'], [
    ['Each of 4 genes', '0 to 15'],
    ['What a gene does to its stat', `${pct(E.stats.geneBase - 1)} to +${pct(E.stats.geneBase + 15 * E.stats.genePerPoint - 1)}`],
    ['Traits on common and rare cards', '1'],
    ['Traits on epic and legendary cards', '2'],
    ['Hue shift from the species', `up to ${E.cosmetics.hueShift} degrees`],
  ])}

<h2>${PICS.egg}${heading('Fusion, crafting and recycling')}</h2>
${table(['Action', 'Sparks'], [
    ['Fuse two cards', `${E.fusion.cost} (${E.fusion.fairCost} on Fusion Fair)`],
    ['Buy a pack', E.packs.buyCost],
    ...(['common', 'rare', 'epic', 'legendary'] as const).map(r => [`Craft ${r === 'epic' ? 'an' : 'a'} ${r} of this season`, E.craft[r]] as const),
    ...(['common', 'rare', 'epic', 'legendary'] as const).map(r => [`Recycle ${r === 'epic' ? 'an' : 'a'} ${r}`, `${E.recycle[r]}`] as const),
  ])}
<p>A fusion takes the higher parent's rarity, with a ${pct(E.fusion.tierUp)} chance of one tier up (never into legendary). Recycling pays ${E.recycleShiny}x for shiny, ${E.recycleFoil}x for foil and ${E.recycleMythic}x again for a Mythic.</p>

<h2>${PICS.lamp}${heading('Packs over time')}</h2>
<p>A pack charges after every ${E.packs.presenceMinutes} minutes with Claude Code open, idle time included, at least ${mins(E.packs.chargeSpacingMs)} apart. You can hold ${E.packs.bank} unopened packs; open some to make room. There are no daily limits on battles, catches or packs.</p>

<h2>${PICS.sun}${heading('The daily rule')}</h2>
${table(['Rule', 'What it does'], DAILY_RULES.map(r => [RULE_INFO[r].name, RULE_INFO[r].text]))}

<h2>${PICS.wheel}${heading('Families')}</h2>
${table(['Family', 'Beats'], FAMILIES.map(f => [FAMILY_INFO[f].name, FAMILY_INFO[FAMILY_INFO[f].beats].name]))}
<p>A family hits ${E.battle.typeStrong}x as hard against the one it beats, and ${E.battle.typeWeak}x against the one that beats it.</p>
</article>`
}

let SLEEPER = ''
const sleeper = () => (SLEEPER ||= spriteSvg(spriteFor({ form: regulars()[5]!, stage: 1 }), { cls: 'shut' }))

export const PROSE_CSS = PAPER_CSS + `
main{display:block;background:var(--paper);color:var(--pink)}
.paperpage h1 .pt{--gp:3px}
@media (min-width:768px){.paperpage h1 .pt{--gp:4px}}
@media (min-width:1024px){.paperpage h1 .pt{--gp:6px}}
.paperpage h1{--sho:.3}
.paperpage h2{display:flex;align-items:center;gap:12px;--sho:.28}
.paperpage h2 .pt{--gp:3px}
@media (min-width:1024px){.paperpage h2 .pt{--gp:4px}}
.pic{width:32px;height:auto;flex:none}
.table{table-layout:fixed}
.table thead th:first-child{width:62%}
.table.wide thead th:first-child{width:28%}
.table .gem{display:inline-block;width:10px;height:10px;margin-right:6px;vertical-align:-1px;background:var(--rar);
clip-path:polygon(40% 0,60% 0,60% 20%,80% 20%,80% 40%,100% 40%,100% 60%,80% 60%,80% 80%,60% 80%,60% 100%,40% 100%,40% 80%,20% 80%,20% 60%,0 60%,0 40%,20% 40%,20% 20%,40% 20%)}
@media (max-width:599px){.table.wide thead th:first-child{width:24%}.table.wide{font-size:.8125rem}.table.wide .gem{display:none}}
.tufts{display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--s3);max-width:520px}
.tufts i{display:block;width:10px;height:8px;background:#5f9f4a;clip-path:polygon(0 100%,0 40%,20% 40%,20% 0,40% 0,40% 40%,60% 40%,60% 20%,80% 20%,80% 50%,100% 50%,100% 100%)}
.tufts i.glow{background:#ff7ac6;box-shadow:0 0 0 2px #ff7ac655}
.sleeper{margin-bottom:var(--s3)}
.sleeper .spr{width:96px;height:96px}
`

export function privacyBody(): Raw {
  return html`<article class="paperpage wrap">
<div class="sleeper" aria-hidden="true">${raw(sleeper())}</div>
<h1>${heading('Privacy, in plain words')}</h1>
<p class="lede">Spinlings runs inside Claude Code, which is where your work happens. So privacy outranks every other rule in the game. This page says what the mod reads, what it sends, what this server keeps and who can see what.</p>

<h2>${heading('The short version')}</h2>
<ul>
<li><strong>You start with a generated identity.</strong> Your account has a random token and a generated handle like soft-otter-42. You can choose a public username instead. Nothing about your Claude account, email, organization or machine is ever sent.</li>
<li><strong>Nothing about your work leaves your machine.</strong> The mod never reads your prompts, Claude's answers, tool calls, files, paths, repository names or cost.</li>
<li><strong>Nothing about your usage is shown to anyone.</strong> The only usage-related value the server receives is a model family (haiku, sonnet, opus or fable), when you join, a pack charges or a battle starts. Nobody else sees it, and it is deleted with that pack or battle.</li>
<li><strong>No IP addresses, no request logs, no analytics,</strong> and no third-party requests, in the mod or on this server.</li>
<li><strong>You can delete everything</strong> from <code>/spin privacy</code> inside Claude Code.</li>
</ul>

<h2>${heading('What the mod reads')}</h2>
<p>Only the shape of your session: which model, whether Claude is working, how a turn ended, how many helpers are running, context fill and rate limits, how long Claude Code has been open, and effort for local appearance. It never hooks tool calls, prompt submissions or permission requests, and it never uses files, programs, models, prompts, tools, agents, MCP servers or environment variables.</p>

<h2>${heading('What the mod sends')}</h2>
<p>Requests go only to the one server in the mod's settings, over https. Each body holds game choices and nothing else: the proof-of-work answer and a model family when you join, a model family for a pack charge or a battle, the round numbers on which you pressed 1, and the ids of the cards, packs, offers or codes you act on. <code>/spin privacy</code> shows the last 20 requests the mod sent, with your token hidden.</p>
<p>Changing your public username in the browser sends only the name you choose to this server. Passkeys stay attached to the same account when your name changes.</p>

<h2>${heading('What this server keeps')}</h2>
<div class="tablewrap"><table class="table">
<thead><tr><th scope="col">What</th><th scope="col">For how long</th></tr></thead>
<tbody>
<tr><td>A player id, your handle, and SHA-256 hashes of your session tokens (never a token)</td><td>Until you delete your account</td></tr>
<tr><td>Your game: cards, team, packs, sparks, rating, league, streak, wishlist and album</td><td>Until you delete your account</td></tr>
<tr><td>Your stats: counts of duel wins and losses, players beaten, wild wins, catches, species, first finds, Mythics found and market sales, all time and this season</td><td>Until you delete your account, as counts with no dates or times</td></tr>
<tr><td>The day you joined and the day you were last seen, never a time</td><td>Until you delete your account</td></tr>
<tr><td>A saved passkey's public key, if you save one</td><td>Until you delete your account</td></tr>
<tr><td>The model family of a pack charge or a battle</td><td>Only as long as that pack or battle</td></tr>
<tr><td>Battles</td><td>7 days after they settle</td></tr>
<tr><td>Notices, and finished offers and gifts</td><td>30 days</td></tr>
<tr><td>A keyed, daily-changing hash of your network address, for join limits</td><td>24 hours</td></tr>
</tbody></table></div>
<p>Never kept: your IP address, user agent, timezone, email, Claude account, organization, or anything about your work.</p>

<h2>${heading('What other players can see')}</h2>
<ul>
<li><strong>Your profile:</strong> your handle, team, cards marked for trade, album count and league, your market listings, and your stats unless you hide from the leaderboards. Nothing else.</li>
<li><strong>The leaderboards:</strong> every player is on them unless they hide with <code>/spin leaderboard off</code>: your handle, league, rank and the board's number. Numbers show as they stood at the last midnight, so nobody can watch them move while you play.</li>
<li><strong>Duels:</strong> the other player gets a notice with your handle and the result, dated "today" or "yesterday".</li>
<li><strong>Mythics:</strong> if you catch one, its card and the public list show your handle and its name. Change your handle or delete your account and they say it was found by a trainer, so your old handle never shows beside a new one.</li>
<li><strong>First discoveries:</strong> a card that was the first of its species in the world says so, and that it was first found by a trainer. It never says which one.</li>
</ul>
<p>Never visible to anyone else: your battle count, when you joined or were last seen, your activity, the arena or model you used, and any timestamps. Duel wins and losses show only as counts in your stats, and you can hide those.</p>
<p>The pages of this site set no cookies and load nothing from other sites. Public-page scripts draw creatures locally and make no API calls; /odds and this page run none at all. Passkey pages and <a href="/account">Your collection</a> talk only to this server.</p>
<p>Your collection signs in with a saved passkey and shows your own cards, stats and board places. Its session stays in this tab's session storage, never in a URL, cookie or public page. Sign out revokes only that browser session. Closing the tab clears its local token. No new game fields or public player information are stored.</p>
<p>The website remembers the creature you met in your browser's own storage so it can greet you next time. It never leaves your browser.</p>

<h2>${heading('Deleting your account')}</h2>
<p><code>/spin privacy</code> has a delete button behind a 2-second hold. It removes your player record and all of your cards, packs, battles, offers, gifts, market listings, notices, wishlist, stats, board places and first-discovery credit. Cards you already traded, sold or gave away stay with their new owners. Your handle stays reserved for 30 days, then anyone can get it.</p>
<p>The full policy, including what someone could still guess and how this is checked, is in <a href="${REPO}/blob/main/PRIVACY.md">PRIVACY.md</a>.</p>
</article>`
}
