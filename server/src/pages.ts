// The site (SPEC 9 Shares, 12 Pages, 25, 29, 30, 31): the landing page, /odds and /privacy, a
// player's public profile, card pages with their og:image, gift and drop pages, and the two passkey
// pages with their one script. Every page is read-only, carries no token, escapes every value
// (pages-html.ts) and shows only what SPEC 20 lets anyone see. Anything that is not there, not open
// or not public answers the same plain "not here" page.
import { cardName, geneScore } from '../../plugin/hooks/core/cards.ts'
import { promoForm } from '../../plugin/hooks/core/drops.ts'
import { FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import type { BattleCard, DropRewardItem, Family, PromoEgg } from '../../plugin/hooks/core/types.ts'
import type { Api, Ctx } from './app.ts'
import { passkeyPage } from './game/auth.ts'
import { rpIdOf } from './game/passkeys.ts'
import { png } from './http.ts'
import { cardPng, formSvg } from './pages-art.ts'
import { landing, openGift, profile, publicCardById, publicDrop } from './pages-data.ts'
import type { Drop } from './pages-data.ts'
import {
  cardTile, cardTiles, command, FULL_CSS, fullCard, html, installBlock, layout, notice, raw, rarityWord, text,
} from './pages-html.ts'
import type { Raw } from './pages-html.ts'
import { oddsBody, privacyBody } from './pages-info.ts'
import { LANDING_CSS, landingBody } from './pages-landing.ts'
import { PASSKEY_JS } from '../static/passkey.ts'

const MINUTE_CACHE = 'public, max-age=60'
const HOUR_CACHE = 'public, max-age=3600'

const describeCard = (c: BattleCard) => `${rarityWord(c).toLowerCase()} ${FAMILY_INFO[c.family].name} creature`
const a = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

export function pages(api: Api): void {
  const page = (path: string, handler: (ctx: Ctx) => Promise<Response> | Response, limit?: string) =>
    api.add({ method: 'GET', path, public: true, ...(limit ? { limit } : {}), handler })

  page('/', async ctx => layout({
    title: 'Spinlings: creatures that battle while Claude works',
    description: 'A creature card game inside Claude Code. Wild ones find you while Claude works; battle, catch, fuse and trade one-of-a-kind cards. It never reads your work.',
    path: '/', origin: ctx.origin, css: LANDING_CSS, cache: MINUTE_CACHE,
    og: { title: 'Spinlings', description: 'Tiny creatures battle above your prompt while Claude works. Free, open source, and it never reads your work.' },
    body: landingBody(await landing(ctx.db, ctx.now)),
  }))

  page('/odds', ctx => layout({
    title: 'Odds: Spinlings', description: 'Every rate in Spinlings: packs, wild encounters, catches, Mythics, fusion and more.',
    path: '/odds', origin: ctx.origin, cache: HOUR_CACHE, body: oddsBody(),
  }))

  page('/privacy', ctx => layout({
    title: 'Privacy: Spinlings', description: 'What Spinlings reads, sends and keeps, and who can see what. It never reads your work.',
    path: '/privacy', origin: ctx.origin, cache: HOUR_CACHE, body: privacyBody(),
  }))

  page('/u/:handle', async ctx => {
    const p = await profile(ctx.db, ctx.params.handle!, ctx.now)
    if (!p) return missing(ctx, 'No keeper by that name', 'Handles are random and can change once a week, so an old link may point nowhere.')
    const handle = text(p.handle, 40)
    return layout({
      title: `${handle}: Spinlings`, description: `${handle}'s team and cards marked for trade.`,
      path: `/u/${p.handle}`, origin: ctx.origin, noindex: true, cache: MINUTE_CACHE, css: PROFILE_CSS,
      body: html`<section class="wrap profile">
<h1>${handle}</h1>
<p class="chips"><span class="chip">${p.league} league</span><span class="chip">${p.seenCount} species in their album</span></p>
<h2>Team</h2>
${p.team.length ? cardTiles(p.team, { link: true }) : html`<p class="empty">No team saved right now.</p>`}
<h2>For trade</h2>
${p.forTrade.length ? cardTiles(p.forTrade, { link: true }) : html`<p class="empty">Nothing marked for trade right now.</p>`}
<div class="cta"><h2>Trade with ${handle}</h2><p class="soft">Install Spinlings, then type <code>/spin trade ${handle}</code> inside Claude Code to build an offer.</p>${installBlock()}</div>
</section>`,
    })
  }, 'profile')

  page('/c/:id', async ctx => {
    const param = ctx.params.id!
    const isPng = param.endsWith('.png')
    const card = await publicCardById(ctx.db, isPng ? param.slice(0, -4) : param)
    if (!card) return missing(ctx, 'No such card', 'It may have been recycled or fused into something new.')
    if (isPng) return png(await cardPng(card, new URL(ctx.origin).host), HOUR_CACHE)
    const name = text(cardName(card), 48)
    const traits = card.traits.map(t => TRAITS[t]?.name ?? t).join(', ')
    return layout({
      title: `${name}: Spinlings`,
      description: `${name}, ${a(rarityWord(card))} ${describeCard(card)} in Spinlings.`,
      path: `/c/${card.id}`, origin: ctx.origin, noindex: true, cache: 'public, max-age=300', css: FULL_CSS + CARD_CSS,
      og: {
        title: `${name}, ${a(rarityWord(card))} ${describeCard(card)}`,
        description: `Level ${card.level}, genes ${geneScore(card.genes)}%${traits ? `, ${traits}` : ''}. Every Spinling is one of a kind. Find your own while Claude works.`,
        image: `${ctx.origin}/c/${card.id}.png`, imageAlt: `${name}, a pixel creature`,
      },
      body: html`<section class="wrap cardpage">
${fullCard(card)}
<div class="cta"><h2>Every Spinling is one of a kind</h2><p class="soft">Each card has its own look, genes and traits, and no two are alike. Yours are waiting in the grass.</p>${installBlock()}</div>
</section>`,
    })
  }, 'profile')

  page('/g/:code', async ctx => {
    const code = ctx.params.code!
    const card = await openGift(ctx.db, code, ctx.now)
    if (!card) {
      return missing(ctx, 'This gift is not waiting any more', 'It may have been claimed already, or its link ran out after 14 days.', 'no-store')
    }
    const name = text(cardName(card), 48)
    return layout({
      title: 'A Spinling is waiting for you', description: `Someone sent you ${a(rarityWord(card))} ${describeCard(card)}. Claim it inside Claude Code.`,
      path: `/g/${code}`, origin: ctx.origin, noindex: true, css: GIFT_CSS,
      og: {
        title: 'A Spinling is waiting for you', description: `Someone sent you ${name}, ${a(rarityWord(card))} ${describeCard(card)}. Claim it inside Claude Code.`,
        image: `${ctx.origin}/c/${card.id}.png`, imageAlt: `${name}, a pixel creature`,
      },
      body: html`<section class="wrap gift">
<ul class="cards present">${cardTile(card)}</ul>
<div class="how">
<h1>A Spinling is waiting for you</h1>
<p class="lede">Someone sent you ${name}, ${a(rarityWord(card))} ${describeCard(card)}. It is yours once you claim it.</p>
<ol class="steps">
<li><h2>Install Spinlings</h2>${installBlock()}</li>
<li><h2>Start a new Claude Code session</h2><p class="soft">Your own starter team hatches right away.</p></li>
<li><h2>Claim your gift</h2><pre class="cmd" aria-label="The claim command">${command(`/spin claim ${code}`)}</pre></li>
</ol>
<p class="soft fine">Gift links last 14 days and work once.</p>
</div>
</section>`,
    })
  }, 'profile')

  page('/d/:code', async ctx => {
    const drop = await publicDrop(ctx.db, ctx.params.code!, ctx.now)
    if (!drop) return missing(ctx, 'No drop by that name', 'Check the code for typos. Some codes are one of a kind and have no page.')
    return layout({
      title: `${drop.code}: a Spinlings drop`, description: dropLine(drop),
      path: `/d/${drop.code}`, origin: ctx.origin, cache: 'public, max-age=30', css: GIFT_CSS + DROP_CSS,
      og: { title: `${drop.code}: a Spinlings drop`, description: dropLine(drop) },
      body: dropBody(drop),
    })
  }, 'profile')

  for (const kind of ['add', 'signin'] as const) {
    page(`/passkey/${kind}`, async ctx => {
      const ticket = ctx.url.searchParams.get('t') ?? ''
      const data = await passkeyPage(ctx.db, { kind, ticket, now: ctx.now, rpId: rpIdOf(ctx.origin) })
      if (!data) {
        return notice({
          title: 'This link has expired: Spinlings', heading: 'This link has expired', path: `/passkey/${kind}`, origin: ctx.origin, status: 410,
          lines: ['Passkey links work once and only for 10 minutes. Start again inside Claude Code with /spin devices.'],
        })
      }
      return passkeyBody(ctx, kind, ticket, data.options)
    }, 'profile')
  }

  page('/static/passkey.js', () => new Response(PASSKEY_JS, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': HOUR_CACHE },
  }))
}

/** The one "not here" page for everything unknown, gone or private: it never says which. */
function missing(ctx: Ctx, heading: string, line: string, cache = MINUTE_CACHE): Response {
  return notice({
    title: `${heading}: Spinlings`, heading, path: ctx.url.pathname, origin: ctx.origin, status: 404, cache,
    lines: [line],
    extra: html`<p><a href="/">Visit the meadow</a> to see this season's creatures.</p>`,
  })
}

// ---- drops -------------------------------------------------------------------------------------

const eggOf = (d: Drop): PromoEgg | null => {
  const items: DropRewardItem[] = Array.isArray(d.reward) ? d.reward : [d.reward]
  for (const i of items) if (i.type === 'egg') return i.promo
  return null
}

function rewardWords(i: DropRewardItem): string {
  const fam = (f?: Family) => (f ? `${FAMILY_INFO[f].name} ` : '')
  if (i.type === 'egg') return `${a(i.promo.rarity)} ${i.promo.rarity}${i.promo.foil ? ' foil' : ''} ${FAMILY_INFO[i.promo.family].name} creature stamped "${text(i.promo.stamp, 40)}"`
  if (i.type === 'pack') return `${i.count === 1 ? 'a' : i.count} ${fam(i.family)}pack${i.count === 1 ? '' : 's'}`
  return `${a(i.rarity)} ${i.rarity} ${fam(i.family)}card`
}

function dropLine(d: Drop): string {
  const items: DropRewardItem[] = Array.isArray(d.reward) ? d.reward : [d.reward]
  const words = items.map(rewardWords)
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]!
  return `Redeem ${d.code} in Spinlings for ${list}.`
}

function dropBody(d: Drop): Raw {
  const egg = eggOf(d)
  const left = d.supply === null ? null : Math.max(0, d.supply - d.redeemed)
  const art = egg
    ? raw(formSvg(promoForm(egg), egg.rarity === 'legendary' ? 3 : 1, { scale: 8, shadow: true, label: 'A creature still in its egg' }))
    : html`<span class="packart" aria-hidden="true"></span>`
  return html`<section class="wrap gift drop">
<div class="eggbox" style="--fam:var(--${egg?.family ?? 'fable'})">${art}</div>
<div class="how">
<p class="k">Drop code</p>
<h1 class="code">${d.code}</h1>
<p class="lede">${dropLine(d)}${egg ? ' Everyone gets the same creature, but each one hatches with its own look.' : ''}${d.bound ? ' It stays in your collection: drop cards cannot be traded or gifted.' : ''}</p>
<p class="count"><strong>${d.redeemed.toLocaleString('en-US')}</strong> redeemed so far${left !== null ? html`, <strong>${left.toLocaleString('en-US')}</strong> of ${d.supply!.toLocaleString('en-US')} left` : ''}.</p>
${d.ended
    ? html`<p class="ended">This drop has ended. There will be others.</p>${installBlock()}`
    : html`<ol class="steps">
<li><h2>Install Spinlings</h2>${installBlock()}</li>
<li><h2>Redeem the code</h2><pre class="cmd" aria-label="The redeem command">${command(`/spin redeem ${d.code}`)}</pre></li>
</ol>`}
</div>
</section>`
}

// ---- passkeys ----------------------------------------------------------------------------------

const PASSKEY_COPY = {
  add: {
    title: 'Save your collection with a passkey',
    lede: 'A passkey lets you play with this collection on another computer. No email and no password: your device or password manager keeps it.',
    warning: 'You are saving a passkey for Spinlings on your own computer. If someone sent you this link, close this page: continuing would tie your passkey to their account.',
    button: 'Save a passkey',
  },
  signin: {
    title: 'Sign in with your passkey',
    lede: 'Bring your Spinlings collection to this computer with the passkey you saved before.',
    warning: 'You are signing in to Spinlings on your own computer. If someone sent you this link, close this page: continuing would give them your account.',
    button: 'Sign in with a passkey',
  },
} as const

function passkeyBody(ctx: Ctx, kind: 'add' | 'signin', ticket: string, options: unknown): Response {
  const copy = PASSKEY_COPY[kind]
  const host = new URL(ctx.origin).host
  return layout({
    title: `${copy.title}: Spinlings`, description: copy.lede, path: `/passkey/${kind}`, origin: ctx.origin,
    noindex: true, script: true, css: PASSKEY_CSS,
    body: html`<section class="wrap pk" id="passkey" data-kind="${kind}" data-ticket="${ticket}" data-options="${JSON.stringify(options)}" data-state="ready">
<p class="site">You are on <strong class="host">${host}</strong></p>
<h1>${copy.title}</h1>
<p class="lede">${copy.lede}</p>
<div class="warn" role="note"><p><strong>Only continue if you opened this page yourself.</strong></p><p>${copy.warning}</p></div>
<button id="go" class="go" type="button">${copy.button}</button>
<p id="status" class="status" role="status" aria-live="polite"></p>
<noscript><p class="status">This page needs JavaScript to talk to your passkey.</p></noscript>
</section>`,
  })
}

// ---- page styles -------------------------------------------------------------------------------

const PROFILE_CSS = `
.profile h1{font-size:clamp(2rem,1.4rem + 2.4vw,3rem);overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s3)}
.profile>h2{margin:var(--s5) 0 var(--s3)}
.cardlink{display:flex;flex-direction:column;align-items:center;gap:var(--s2);width:100%;color:inherit;text-decoration:none}
.cardlink:hover .name{text-decoration:underline}
.empty{padding:var(--s3);border-radius:12px;background:var(--surface);color:var(--soft)}
.cta{margin-top:var(--s5);padding-top:var(--s4);border-top:1px solid var(--line)}
.cta>p{margin-top:var(--s2)}
`

const CARD_CSS = `
.cardpage{max-width:960px}
.cta{margin-top:var(--s5)}
.cta>p{margin-top:var(--s2)}
`

const GIFT_CSS = `
.gift{display:grid;gap:var(--s4);align-items:start}
@media (min-width:860px){.gift{grid-template-columns:minmax(220px,300px) 1fr;gap:var(--s5);padding-top:var(--s5)}}
.present{grid-template-columns:1fr;--px:8px}
.present .card{padding:var(--s4) var(--s3) var(--s3)}
.present .name{font-size:1.25rem}
.how h1{font-size:clamp(2rem,1.4rem + 2.4vw,3rem)}
.steps{list-style:none;counter-reset:step;margin:var(--s4) 0 0;padding:0;display:grid;gap:var(--s4)}
.steps>li{counter-increment:step;position:relative;padding-left:44px}
.steps>li::before{content:counter(step);position:absolute;left:0;top:0;width:30px;height:30px;border-radius:50%;background:var(--chip);display:grid;place-items:center;
font:800 .9375rem/1 var(--round)}
.steps h2{font-size:1.1875rem;line-height:30px}
.steps .install{margin-top:var(--s2)}
.steps .install .label{display:none}
.steps p.soft{margin-top:var(--s1)}
.steps .cmd{margin-top:var(--s2)}
.fine{margin-top:var(--s4);font-size:.9375rem}
`

const DROP_CSS = `
.eggbox{display:grid;place-items:center;aspect-ratio:3/2;border-radius:24px;background:var(--sky);border-bottom:12px solid var(--fam)}
.eggbox svg{width:min(160px,40vw);height:auto;color:color-mix(in oklab,var(--fam) var(--hide),var(--shade))}
.packart{display:block;width:120px;height:150px;border-radius:10px;background:repeating-linear-gradient(135deg,var(--fam) 0 12px,color-mix(in oklab,var(--fam) 70%,#fff) 12px 24px);
box-shadow:inset 0 0 0 6px color-mix(in oklab,var(--fam) 60%,#000)}
.drop .k{font-size:.875rem;color:var(--soft)}
.drop .code{font-family:var(--mono);letter-spacing:.04em;overflow-wrap:anywhere}
.count{margin-top:var(--s3);font-size:1.125rem}
.count strong{font:800 1.375rem var(--round);font-variant-numeric:tabular-nums}
.ended{margin-top:var(--s3);padding:var(--s3);border-radius:12px;background:var(--surface)}
@media (min-width:860px){.eggbox{aspect-ratio:1}.eggbox svg{width:192px}}
`

const PASSKEY_CSS = `
.pk{padding-top:var(--s5)}
.pk>*{max-width:640px}
.site{display:inline-block;margin-bottom:var(--s3);padding:6px 12px 7px;border-radius:999px;background:var(--chip);font-size:.9375rem}
.host{font-family:var(--mono);font-size:1rem}
.pk h1{font-size:clamp(1.875rem,1.4rem + 2vw,2.625rem)}
.warn{margin-top:var(--s4);padding:var(--s3);border-radius:12px;border:2px solid #d9675a;background:color-mix(in oklab,#d9675a 10%,var(--surface))}
.warn p+p{margin-top:var(--s1)}
.go{margin-top:var(--s4);min-height:48px;padding:0 var(--s4) 1px;border:0;border-radius:12px;background:var(--ink);color:var(--bg);font:700 1.0625rem/1 var(--round);cursor:pointer}
.go:hover{filter:brightness(1.15)}
.go:disabled{opacity:.5;cursor:default}
.status{margin-top:var(--s3);min-height:1.6em;color:var(--soft)}
.pk[data-state=done] .status{color:var(--ink);font-weight:600}
.pk[data-state=error] .status{color:#c2493d}
@media (prefers-color-scheme:dark){.pk[data-state=error] .status{color:#f08a7e}}
`
