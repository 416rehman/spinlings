// The landing page: a meadow where the day's featured creature rustles out of the grass in front of
// a team of three (one orchestrated CSS moment on load, then stillness), how the game plays, today's
// rule, this season's 36 species with silhouettes for the unfound, the Mythics found so far (handle
// and name only), the privacy promise and the one-line install.
import { promoForm } from '../../plugin/hooks/core/drops.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import type { CardForm, Family, Species } from '../../plugin/hooks/core/types.ts'
import { RULE_INFO } from '../../plugin/hooks/core/world.ts'
import { FAMILY_COLOR, FAMILY_MARK, MARK } from '../../plugin/hooks/ui/tokens.ts'
import { formSvg, hillsSvg, motesSvg, pixelTextSvg, tuftSvg } from './pages-art.ts'
import { ASK, command, GRASS, html, INSTALL, installBlock, raw, text } from './pages-html.ts'
import type { Raw } from './pages-html.ts'
import type { Landing } from './pages-data.ts'

/** The meadow's regulars: creatures of no season, drawn from fixed seeds, so the hero never spoils the album. */
const mascot = (seed: string, family: Family): CardForm =>
  promoForm({ seed, name: 'Spinling', family, rarity: 'rare', foil: false, stamp: '' })
const MASCOTS = [
  { form: mascot('meadow-pip', 'haiku'), stage: 2 as const },
  { form: mascot('meadow-lull', 'sonnet'), stage: 3 as const },
  { form: mascot('meadow-ember', 'opus'), stage: 2 as const },
]
const VIGNETTE = { fable: mascot('meadow-moth', 'fable'), sonnet: mascot('meadow-lull', 'sonnet') }

const famStyle = (f: Family) => `--fam:${FAMILY_COLOR[f]}`
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export function landingBody(d: Landing): Raw {
  const featured = d.species.find(s => s.id === d.world.featured)!
  const rule = RULE_INFO[d.world.rule]
  const name = text(featured.names[0], 40)
  return html`
<section class="hero wrap">
<div class="pitch">
<h1>Tiny creatures battle above your prompt while Claude works.</h1>
<p class="lede">Spinlings is a creature card game inside Claude Code. Wild ones find you mid-task, your team of three battles them, and a win can catch a one-of-a-kind card to fuse, gift or trade.</p>
</div>
<div class="console">
${meadow(featured)}
<div class="prompt"><span class="caret" aria-hidden="true">&gt;</span><pre class="cmd" aria-label="Install command, to type inside Claude Code">${command(INSTALL)}</pre></div>
</div>
<div class="under"><p>Type it inside Claude Code, or just ask Claude: <q>${ASK}</q></p><p>Free and open source. No account, no email, and it never reads your work.</p></div>
</section>

<section class="wrap" id="how" aria-labelledby="how-h">
<div class="head"><h2 id="how-h">How it plays</h2><p>Three moments, none of them on demand. Claude never waits for a battle, and a battle never waits for Claude.</p></div>
<div class="moments">
<div class="moment"><div class="vig" style="${famStyle(featured.family)}">${raw(formSvg(featured, 1, { scale: 4, shadow: true, cls: 'px peek' }))}${raw(tuftSvg({ scale: 4, cls: 'px tuft' }))}</div>
<h3>Creatures find you while Claude works</h3>
<p>Once Claude has been busy for ${ECONOMY.battle.encounterAfterMs / 1000} seconds, something may rustle in a slim band above your prompt. Packs charge while Claude Code is open, even when Claude is idle.</p></div>
<div class="moment"><div class="vig">${raw(formSvg(VIGNETTE.sonnet, 3, { scale: 4 }))}<span class="spark" aria-hidden="true">${raw(pixelTextSvg('!', { scale: 4 }))}</span>${raw(formSvg(VIGNETTE.fable, 2, { scale: 4 }))}</div>
<h3>Battle, then catch</h3>
<p>Your team fights on its own. Press 1 the moment its special fires for a Perfect hit. Win, and you may catch one of the wild ones. You never lose a card.</p></div>
<div class="moment"><div class="vig swap"><span class="mini" style="${famStyle('haiku')}">${raw(formSvg(MASCOTS[0]!.form, 2, { scale: 3 }))}</span><span class="arrows" aria-hidden="true">${raw(pixelTextSvg('<>', { scale: 4 }))}</span><span class="mini" style="${famStyle('opus')}">${raw(formSvg(MASCOTS[2]!.form, 2, { scale: 3 }))}</span></div>
<h3>Trade with other players</h3>
<p>Mark cards for trade, send offers, or gift one with a link. Nobody around yet? Rivals step in for duels and the Wandering Trader keeps a shop.</p></div>
</div>
</section>

<section class="wrap" id="today" aria-labelledby="today-h">
<div class="head"><h2 id="today-h">Today in the meadow</h2></div>
<div class="today">
<div class="rule"><p class="k">Daily rule</p><p class="v">${rule.name}</p><p class="soft">${rule.text}.</p></div>
<div class="feat" style="${famStyle(featured.family)}">${raw(formSvg(featured, 1, { scale: 4, label: name }))}<div><p class="k">Featured species</p><p class="v">${name}</p><p class="soft"><span class="mark" aria-hidden="true">${FAMILY_MARK[featured.family]}</span> ${FAMILY_INFO[featured.family].name}. Turns up in ${Math.round(ECONOMY.wild.featured * 100)}% of wild encounters today.</p></div></div>
<div class="when"><p class="k">Season ${d.world.season}</p><p class="v">Day ${d.seasonDay} of 28</p><p class="soft">${plural(d.daysLeft, 'day')} until 36 new species arrive.</p></div>
</div>
</section>

${gallery(d)}

<section class="wrap" id="mythics" aria-labelledby="mythics-h">
<div class="head"><h2 id="mythics-h">Mythics found</h2><span class="chip">${d.mythicCount} so far</span>
<p>About one wild encounter in ${Math.round(1 / ECONOMY.wild.mythicChance)} is led by a creature that never existed before and never will again. If it gets away, it is gone for good.</p></div>
${d.mythics.length
    ? html`<ul class="mythics">${d.mythics.map(m => html`<li><span class="mark" aria-hidden="true">${MARK.mythic}</span><span><b>${text(m.name, 48)}</b> <span class="soft">${m.handle ? html`found by <a href="/u/${m.handle}">${text(m.handle, 40)}</a>` : 'found by a keeper'}</span></span></li>`)}</ul>`
    : html`<p class="empty">No Mythic has been caught yet. The first one could rustle out of the grass during your next long task.</p>`}
</section>

<section class="wrap promise" id="privacy" aria-labelledby="privacy-h">
<div class="zero">${raw(pixelTextSvg('0', { scale: 16, cls: 'ptext big' }))}<h2 id="privacy-h"><span class="sr">0 </span>lines of your work we read</h2></div>
<ul class="facts">
<li><strong>No account.</strong> You get a random handle like soft-otter-42. Nothing ties it to you.</li>
<li><strong>Content-blind.</strong> The mod sees only the shape of a session: which model, whether Claude is busy. Never prompts, files, commands or output.</li>
<li><strong>Nothing kept that could find you.</strong> No IP addresses, no request logs, no analytics, no third parties.</li>
<li><strong>Yours to delete.</strong> One hold in <code>/spin privacy</code> removes everything.</li>
</ul>
<p class="more"><a href="/privacy">Exactly what is stored, and for how long</a></p>
</section>

<section class="wrap closer" aria-labelledby="closer-h">
<h2 id="closer-h">Your first creature hatches the moment you install.</h2>
<p class="soft">A starter team of three, two welcome packs, and a wild encounter on Claude's first long turn. Prefer to stay off the network? Spinlings plays fully offline too.</p>
${installBlock('install-again')}
</section>`
}

function meadow(featured: Species): Raw {
  const name = text(featured.names[0], 40)
  return html`<div class="meadow" role="img" aria-label="${`A team of three Spinlings in a meadow as a wild ${name} rustles out of the grass`}">
${raw(motesSvg())}${raw(hillsSvg())}
<p class="band" aria-hidden="true"><span class="b1">Something is rustling…</span><span class="b2">A wild <b>${name}</b> appeared!</span></p>
<div class="stage">
<div class="team">${MASCOTS.map((m, i) => html`<div class="critter c${i + 1}">${raw(formSvg(m.form, m.stage, { scale: 6 }))}</div>`)}</div>
<div class="wild" style="${famStyle(featured.family)}">
<div class="sil">${raw(formSvg(featured, 1, { scale: 6, shadow: true }))}</div>
<div class="reveal">${raw(formSvg(featured, 1, { scale: 6 }))}</div>
<div class="tuft">${raw(tuftSvg({ scale: 6 }))}</div>
</div>
</div>
<div class="ground"></div>
</div>`
}

function gallery(d: Landing): Raw {
  const found = d.species.filter(s => d.found.has(s.id)).length
  return html`<section class="wrap" id="season" aria-labelledby="season-h">
<div class="head"><h2 id="season-h">Season ${d.world.season}</h2><span class="chip">${found} of ${d.species.length} found</span>
<p>Every 28 days brings 36 new species, nine per family. The ones nobody has found yet wait in the shadows.</p></div>
${FAMILIES.map(f => html`<div class="fam" style="${famStyle(f)}">
<h3><span class="mark" aria-hidden="true">${FAMILY_MARK[f]}</span> ${FAMILY_INFO[f].name} <small>beats ${FAMILY_INFO[FAMILY_INFO[f].beats].name}</small></h3>
<ul class="species">${d.species.filter(s => s.family === f).map(s => tile(s, d.found.has(s.id), s.id === d.world.featured))}</ul>
</div>`)}
</section>`
}

function tile(s: Species, found: boolean, today: boolean): Raw {
  const name = text(s.names[0], 40)
  const cls = `sp${found ? '' : ' dark'}${s.legendary ? ' legend' : ''}`
  return html`<li class="${cls}">${raw(formSvg(s, 1, { scale: 4, shadow: !found }))}<span class="nm">${found
    ? name : html`<span aria-hidden="true">???</span><span class="sr">${s.legendary ? 'Legendary, not' : 'Not'} found yet</span>`}</span>${s.legendary && found ? html`<span class="sr">, legendary</span>` : ''}${today ? html`<span class="tag">Today</span>` : ''}</li>`
}

export const LANDING_CSS = `
.hero{padding-top:var(--s3)}
.pitch{display:grid;gap:var(--s3)}
.pitch h1{max-width:19ch}
@media (min-width:960px){.hero{padding-top:var(--s4)}.pitch{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);align-items:end;gap:var(--s5)}.pitch .lede{margin:0 0 6px}}
.console{margin-top:var(--s4);border-radius:20px;overflow:hidden;border:1px solid var(--line);background:#1f1d2b}
.prompt{display:flex;gap:12px;padding:14px 20px 16px;color:#f4f2fb}
.prompt .caret{font:700 1.0625rem/1.5 var(--mono);color:#9aa3ad}
.prompt .cmd{flex:1;padding:0;border:0;border-radius:0;background:none;font-size:1rem}
@media (prefers-color-scheme:dark){.console{background:#0b0e14;border-color:#2a3242}}
.under{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);margin-top:var(--s3);font-size:.9375rem;color:var(--soft)}
.under q{color:var(--ink)}

.meadow{--px:4px;position:relative;display:flex;flex-direction:column;justify-content:flex-end;min-height:236px;padding-top:72px;background:var(--sky);overflow:hidden}
@media (min-width:600px){.meadow{--px:5px;min-height:280px}}
@media (min-width:1000px){.meadow{--px:6px;min-height:300px}}
.meadow .stage svg{width:calc(16 * var(--px));height:calc(16 * var(--px))}
.hills{position:absolute;left:0;bottom:calc(7 * var(--px));width:calc(240 * var(--px));height:calc(16 * var(--px));color:var(--hill)}
.motes{position:absolute;inset:0 auto auto 0;width:calc(240 * var(--px));height:calc(40 * var(--px));color:#ffe7a3;opacity:0}
@media (prefers-color-scheme:dark){.motes{opacity:.75}}
.band{position:absolute;left:var(--s3);top:var(--s3);display:grid;max-width:calc(100% - 32px);padding:9px 14px 10px;border-radius:12px;background:var(--surface);border:1px solid var(--line);
font:600 .9375rem/1.3 var(--round)}
.band span{grid-area:1/1}
.band .b2{opacity:0;animation:appear .2s steps(1) 2.4s forwards}
.band .b1{animation:gone 1ms 2.4s forwards}
.stage{position:relative;z-index:1;display:flex;align-items:flex-end;justify-content:space-evenly;gap:var(--s3);margin-bottom:calc(-2 * var(--px))}
.team{display:flex;align-items:flex-end;gap:calc(2 * var(--px))}
.critter{animation:hop .42s steps(3) both}
.c1{animation-delay:2.7s}.c2{animation-delay:2.8s}.c3{animation-delay:2.9s}
@media (hover:hover){.critter:hover svg,.wild:hover .reveal svg{animation:hop .42s steps(3)}}
.wild{position:relative;width:calc(16 * var(--px));height:calc(16 * var(--px))}
.wild>div{position:absolute;inset:0}
.wild .sil{color:color-mix(in oklab,var(--fam) var(--hide),var(--shade));transform:translateY(calc(-1 * var(--px)));animation:rustle .3s steps(2) 8,gone 1ms 2.4s forwards}
.wild .tuft{display:flex;align-items:flex-end;transform-origin:50% 100%;animation:sway .3s steps(2) 8,drop .3s steps(3) 2.4s forwards}
.wild .tuft svg{height:calc(9 * var(--px))}
.wild .reveal{opacity:0;animation:reveal .45s steps(1) 2.4s forwards}
.ground{position:relative;height:calc(7 * var(--px));background:var(--grass) url("data:image/svg+xml,${GRASS}") repeat-x 0 0/calc(16 * var(--px)) calc(6 * var(--px));image-rendering:pixelated;border-top:0}
@keyframes rustle{0%{transform:translate(0,calc(-1 * var(--px)))}50%{transform:translate(var(--px),calc(-2 * var(--px)))}100%{transform:translate(calc(-1 * var(--px)),calc(-1 * var(--px)))}}
@keyframes sway{0%{transform:rotate(0)}50%{transform:rotate(-4deg)}100%{transform:rotate(4deg)}}
@keyframes drop{to{transform:translateY(100%);opacity:0}}
@keyframes gone{to{visibility:hidden;opacity:0}}
@keyframes appear{to{opacity:1}}
@keyframes reveal{0%{opacity:1;filter:brightness(0) invert(1)}25%{opacity:1;filter:none}100%{opacity:1}}
@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-3 * var(--px)))}}
@media (prefers-reduced-motion:reduce){.wild .sil,.wild .tuft,.band .b1{display:none}.wild .reveal,.band .b2{opacity:1}}

.moments{display:grid;gap:var(--s4);margin-top:var(--s4)}
@media (min-width:800px){.moments{grid-template-columns:repeat(3,minmax(0,1fr))}}
.moment h3{margin-top:var(--s3)}
.moment p{margin-top:var(--s2);color:var(--soft);font-size:1rem}
.vig{--px:4px;position:relative;display:flex;align-items:flex-end;justify-content:center;gap:var(--s3);height:120px;padding-bottom:var(--s2);border-radius:16px;background:var(--sky);
border-bottom:calc(3 * var(--px)) solid var(--grass);overflow:hidden}
.vig svg{width:calc(16 * var(--px));height:calc(16 * var(--px))}
.vig .peek{color:color-mix(in oklab,var(--fam) var(--hide),var(--shade));transform:translateY(calc(-2 * var(--px)))}
.vig .tuft{position:absolute;left:50%;bottom:var(--s2);width:calc(16 * var(--px));height:calc(9 * var(--px));transform:translateX(-50%)}
.vig .spark{align-self:center;color:var(--gold)}
.vig .spark svg,.vig .arrows svg{width:auto;height:calc(9 * var(--px))}
.vig.swap{align-items:center;padding-bottom:0}
.vig .mini{display:grid;place-items:center;width:76px;height:88px;border-radius:10px;background:var(--surface);border:2px solid var(--line);border-bottom:4px solid var(--fam)}
.vig .mini svg{width:48px;height:48px}
.vig .arrows{color:var(--soft)}

.today{display:grid;gap:var(--s3)}
@media (min-width:800px){.today{grid-template-columns:repeat(3,minmax(0,1fr));gap:0}.today>div+div{border-left:1px solid var(--line);padding-left:var(--s4)}.today>div{padding-right:var(--s4)}}
.today .k{font-size:.875rem;color:var(--soft)}
.today .v{font:800 1.5rem/1.25 var(--round);margin:2px 0 var(--s1)}
.today .soft{font-size:.9375rem}
.feat{display:flex;gap:var(--s3);align-items:center}
.feat svg{flex:none;width:72px;height:72px;padding:4px;border-radius:12px;background:var(--sky);border-bottom:4px solid var(--fam)}

.fam{margin-top:var(--s4)}
.fam h3{display:flex;align-items:baseline;gap:var(--s2)}
.fam h3 .mark{color:var(--fam);font-size:1.25rem}
.fam h3 small{font:400 .875rem var(--sans);color:var(--soft)}
.species{list-style:none;margin:var(--s3) 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s2)}
.sp{position:relative;display:flex;flex-direction:column;align-items:center;gap:var(--s1);padding:var(--s3) var(--s1) 10px;border-radius:12px;background:var(--surface);border-bottom:3px solid var(--fam);min-width:0}
.sp svg{width:64px;height:64px}
.sp .nm{font:700 .9375rem/1.3 var(--round);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp.dark svg{color:color-mix(in oklab,var(--fam) var(--hide),var(--shade))}
.sp.dark .nm{color:var(--faint);letter-spacing:.08em}
.sp.legend{box-shadow:inset 0 0 0 2px var(--gold)}
.sp .tag{position:absolute;top:6px;right:6px;padding:0 7px 1px;border-radius:999px;background:var(--fam);color:#14121c;font:700 .75rem/1.5 var(--sans)}
@media (min-width:600px) and (max-width:1023px){.sp{flex-direction:row;justify-content:flex-start;gap:var(--s3);padding:var(--s2) var(--s3)}.sp .tag{top:50%;transform:translateY(-50%)}}
@media (min-width:1024px){.species{grid-template-columns:repeat(9,minmax(0,1fr))}}

.mythics{list-style:none;margin:var(--s3) 0 0;padding:0;display:grid;gap:0 var(--s4)}
@media (min-width:720px){.mythics{grid-template-columns:repeat(2,minmax(0,1fr))}}
.mythics li{display:flex;gap:10px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--line)}
.mythics .mark{color:var(--mythic)}
.mythics b{font-family:var(--round)}
.empty{margin-top:var(--s3);padding:var(--s3);border-radius:12px;background:var(--surface);color:var(--soft)}

.promise{display:grid;gap:var(--s4);align-items:center}
@media (min-width:860px){.promise{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:var(--s5)}}
.zero{display:flex;align-items:center;gap:var(--s4)}
.zero .big{flex:none;width:80px;height:auto;color:var(--ink)}
.zero h2{max-width:10ch}
.facts{list-style:none;margin:0;padding:0;display:grid;gap:var(--s3)}
.facts li{color:var(--soft)}
.facts strong{color:var(--ink)}
.promise .more{grid-column:1/-1}
.closer>*{max-width:760px}
.closer p.soft{margin-top:var(--s3)}
`
