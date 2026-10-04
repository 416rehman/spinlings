// The site (SPEC 8, 9 Shares, 12 Pages, 25, 29, 30, 31, 36): the landing meadow, postcards, /odds and
// /privacy, the leaderboards and the market, a player's camp, card pages with their og:image, gift and
// drop pages, the two passkey pages, and the first-party scripts under /static. Every page is read-only, carries no token,
// escapes every value (pages-html.ts) and shows only what SPEC 20 lets anyone see. Anything that is
// not there, not open or not public answers the same plain "not here" page.
import { cardName, geneScore } from '../../plugin/hooks/core/cards.ts'
import { promoForm } from '../../plugin/hooks/core/drops.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { traderDeals } from '../../plugin/hooks/core/trader.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import type { BoardName, BoardPeriod, MarketSort } from '../../plugin/hooks/core/api.ts'
import type { BattleCard, DailyRule, DropRewardItem, Family, PromoEgg } from '../../plugin/hooks/core/types.ts'
import { DAILY_RULES, EPOCH_MS, RULE_INFO, dailyRule, seasonOf, utcDay } from '../../plugin/hooks/core/world.ts'
import { FAMILY_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import type { Api, Ctx } from './app.ts'
import { passkeyPage } from './game/auth.ts'
import { catalogOf } from './game/ctx.ts'
import { rpIdOf } from './game/passkeys.ts'
import { escapeHtml, fail, png } from './http.ts'
import { cardPng } from './pages-art.ts'
import {
  BOARD_IDS, BOARDS, BOARDS_CSS, LOTS_CSS, MARKET_CSS, RANKS_CSS, SORTS, STATS_CSS, boardsBody, lots, marketBody, statTiles,
} from './pages-boards.ts'
import { board, leadsOf, listingsByHandle, marketPage, mythicsShown, openGift, profile, publicCardById, publicDrop } from './pages-data.ts'
import type { Drop } from './pages-data.ts'
import {
  cardFace, cardTiles, FULL_CSS, fullCard, heading, html, installBlock, layout, notice, pixelHeading, PLACE, PLACE_CSS, promptLine, raw, rarityWord, text,
} from './pages-html.ts'
import type { Raw } from './pages-html.ts'
import { oddsBody, privacyBody, PROSE_CSS } from './pages-info.ts'
import { CAMP_CSS, LANDING_CSS, landingBody, teamCamp } from './pages-landing.ts'
import { ENTRY_RE, meet, SEED_RE } from './pages-meet.ts'
import { imageCache, meadowPng, postcardPng } from './pages-og.ts'
import type { ImageCache } from './pages-og.ts'
import { fireSvg, grassSvg, hillSvg, peaksSvg, placeStripSvg } from './pages-scene.ts'
import { shadowSvg, spriteSvg } from './pages-sprite.ts'
import { dayKey, regulars, siteWorld, worldJson } from './pages-world.ts'
import type { Preview } from './pages-world.ts'
import { PASSKEY_JS } from '../static/passkey.ts'
import { SITE_FILES } from '../static/site.gen.ts'

const MINUTE_CACHE = 'public, max-age=60'
const HOUR_CACHE = 'public, max-age=3600'
const DAY_CACHE = 'public, max-age=86400'
const IMMUTABLE = 'public, max-age=31536000, immutable'

const describeCard = (c: BattleCard) => `${rarityWord(c).toLowerCase()} ${FAMILY_INFO[c.family].name} creature`
const a = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

const TITLE = 'Spinlings: wild creatures that find you while Claude works'
const DESCRIPTION = 'A creature card game inside Claude Code. While Claude works, wild ones rustle up above your prompt. Battle, catch, fuse and trade one-of-a-kind cards.'

/**
 * The dev preview (`?preview=rule:wildBloom,shiny:1,...`): only on a local server started with
 * SITE_PREVIEW=1 outside production. The Worker never sets it, so it never exists there.
 */
function previewOf(ctx: Ctx): Preview | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  if (!env || env.SITE_PREVIEW !== '1' || env.NODE_ENV === 'production') return null
  const q = ctx.url.searchParams.get('preview')
  if (!q) return null
  const out: Record<string, string> = {}
  for (const part of q.split(',')) {
    const [k, v] = part.split(':')
    if (k && v && /^[a-z]{1,12}$/i.test(k) && /^[a-z0-9]{1,16}$/i.test(v)) out[k] = v
  }
  return out as Preview
}

export function pages(api: Api): void {
  const page = (path: string, handler: (ctx: Ctx) => Promise<Response> | Response, limit?: string) =>
    api.add({ method: 'GET', path, public: true, ...(limit ? { limit } : {}), handler })

  page('/', async ctx => {
    const preview = previewOf(ctx)
    const w = await siteWorld(ctx.db, ctx.now)
    const shown = await mythicsShown(ctx.db)
    if (preview?.rule && (DAILY_RULES as readonly string[]).includes(preview.rule)) w.rule = preview.rule as DailyRule
    if (preview?.found === 'all') w.found = w.foundToday = w.species.map(s => s.id)
    if (preview?.mythics) {
      const n = Math.min(12, Number(preview.mythics) || 0)
      shown.mythics = Array.from({ length: n }, (_, i) => ({ name: `Preview Lantern ${i + 1}`, handle: null }))
      shown.mythicCount = n
    }
    return layout({
      kind: 'home', title: TITLE, description: DESCRIPTION, path: '/', origin: ctx.origin, css: LANDING_CSS,
      cache: preview ? 'no-store' : MINUTE_CACHE, now: ctx.now, team: true,
      og: {
        title: 'Spinlings', description: 'Wild creatures find you while Claude works. A creature card game inside Claude Code.',
        image: `${ctx.origin}/og/meadow.png`, imageAlt: 'A team of Spinlings on a lamp-lit path as a wild one rustles in the grass.',
      },
      ...(preview?.scheme === 'dark' || preview?.scheme === 'light' ? { scheme: preview.scheme } : {}),
      ...(preview?.motion === 'reduce' ? { motion: 'reduce' as const } : {}),
      world: worldJson(w, preview),
      body: landingBody({ w, ...shown, deals: traderDeals(ctx.now) }),
    })
  })

  // Only generic pages belong in a search index. Player, card, gift, postcard and passkey links
  // remain outside the sitemap; no database read or query parameter becomes a crawler hint.
  page('/robots.txt', ctx => new Response(`User-agent: *\nAllow: /\nDisallow: /v1/\nDisallow: /account\nDisallow: /passkey/\nDisallow: /g/\nSitemap: ${ctx.origin}/sitemap.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': HOUR_CACHE },
  }))
  page('/sitemap.xml', ctx => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/boards', '/market', '/odds', '/privacy'].map(path => `<url><loc>${escapeHtml(ctx.origin + path)}</loc></url>`).join('')}</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': HOUR_CACHE },
  }))

  // first-party scripts, content-hashed and immutable (SPEC 36); only the table's own names, never
  // one it inherits (constructor, __proto__, toString)
  page('/static/:file', ctx => {
    const file = ctx.params.file!
    if (!Object.hasOwn(SITE_FILES, file)) return missing(ctx, 'No such file', 'Scripts here change their names with every release.')
    return new Response(SITE_FILES[file], { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': IMMUTABLE } })
  })

  // Share images: the meadow is drawn once a day, and a postcard once while it is among the last 64
  // asked for. Only a fresh drawing spends from the address's 'share' bucket, so a stream of new seeds
  // cannot keep the server drawing. The Worker also keeps them in its edge cache (worker.ts).
  const meadows = imageCache(1), postcards = imageCache(64)
  const shareImage = async (ctx: Ctx, kept: ImageCache, key: string, draw: () => Promise<Uint8Array>, cache = DAY_CACHE) => {
    let bytes = kept.get(key)
    if (!bytes) {
      ctx.limit('share')
      bytes = kept.set(key, draw())
    }
    return png(await bytes, cache)
  }

  page('/og/:file', async ctx => {
    const stable = ctx.params.file === 'meadow.png'
    const m = /^meadow-(\d{8})\.png$/.exec(ctx.params.file!)
    const today = dayKey(ctx.now), yesterday = dayKey(ctx.now - 86_400_000)
    if (!stable && (!m || (m[1] !== today && m[1] !== yesterday))) return missing(ctx, 'No such picture', 'Meadow pictures last a day.')
    // yesterday's link still unfurls, with today's meadow
    return shareImage(ctx, meadows, today, async () => {
      const w = await siteWorld(ctx.db, ctx.now)
      return meadowPng(w, w.species.find(s => s.id === w.featured)!)
    }, stable ? HOUR_CACHE : DAY_CACHE)
  })

  page('/w/:seed', async ctx => {
    const param = ctx.params.seed!
    const isPng = param.endsWith('.png')
    const seed = isPng ? param.slice(0, -4) : param
    const gone = () => missing(ctx, 'No such postcard', 'Its creature may be from another season.')
    const m = SEED_RE.exec(seed)
    if (!m) return gone()
    const day = `${m[1]}-${m[2]}-${m[3]}`
    const t = Date.parse(day + 'T12:00:00Z')
    if (!Number.isFinite(t) || utcDay(t) !== day || t < EPOCH_MS || day > utcDay(ctx.now)) return gone()
    const e = ctx.url.searchParams.get('e') ?? '', pin = ENTRY_RE.test(e) ? e : undefined
    const host = new URL(ctx.origin).host, key = `${host}/${seed}${pin ? `?e=${pin}` : ''}`
    const kept = isPng ? postcards.get(key) : undefined
    if (kept) return png(await kept, DAY_CACHE)
    // Today's world, never the world as of the seed's day: that one would draw only from what was
    // found before it, so postcards of made-up seeds would date every first find (SPEC 20.3). The
    // link's pin (the sender's kept entry) keeps the creature the sender met.
    const met = meet(seed, await siteWorld(ctx.db, ctx.now, seasonOf(t)), pin)
    if (!met) return gone()
    if (isPng) return shareImage(ctx, postcards, key, () => postcardPng(met, host))
    return postcardPage(ctx, met, dailyRule(t))
  })

  page('/odds', ctx => layout({
    title: 'The almanac: Spinlings', description: 'Every rate in Spinlings: packs, wild encounters, catches, Mythics, fusion and more.',
    path: '/odds', origin: ctx.origin, cache: HOUR_CACHE, now: ctx.now, css: PROSE_CSS, body: oddsBody(),
  }))

  page('/privacy', ctx => layout({
    title: 'Privacy: Spinlings', description: 'What Spinlings reads, sends and keeps, and who can see what.',
    path: '/privacy', origin: ctx.origin, cache: HOUR_CACHE, now: ctx.now, css: PROSE_CSS, body: privacyBody(),
  }))

  // The boards: one board and period per address, so each is a plain link (no script needed). Every number is
  // as of the last UTC midnight, so the page can be cached for a while.
  page('/boards', async ctx => {
    const q = ctx.url.searchParams
    const name = (BOARD_IDS as readonly string[]).includes(q.get('board') ?? '') ? q.get('board') as BoardName : 'rating'
    const period: BoardPeriod = q.get('period') === 'season' ? 'season' : 'all'
    const res = await board(ctx.db, name, period, ctx.now)
    const leads = await leadsOf(ctx.db, res.top.slice(0, 3).map(r => r.handle))
    const tab = BOARDS.find(b => b.id === name)!.tab
    return layout({
      kind: 'site', title: 'Leaderboards: Spinlings', description: 'The top Spinlings trainers by rating, players beaten, duel wins, species, Mythics and market sales.',
      path: '/boards', origin: ctx.origin, cache: 'public, max-age=300', now: ctx.now, css: SITE_CSS + BOARDS_CSS + RANKS_CSS,
      og: { title: `Spinlings leaderboards: ${tab}`, description: 'The top trainers of every board, all time and this season.' },
      body: boardsBody({ res, leads }),
    })
  }, 'browse')

  page('/leaderboards', ctx => new Response(null, { status: 301, headers: { Location: `/boards${ctx.url.search}`, 'Cache-Control': DAY_CACHE } }))

  // The market, read-only: buying happens inside Claude Code.
  page('/market', async ctx => {
    const q = ctx.url.searchParams
    const family = (FAMILIES as readonly string[]).includes(q.get('family') ?? '') ? q.get('family') as Family : undefined
    const sort = (SORTS as readonly string[]).includes(q.get('sort') ?? '') ? q.get('sort') as MarketSort : 'newest'
    const after = q.get('after') ?? undefined
    const res = await marketPage(ctx.db, ctx.now, { ...(family ? { family } : {}), sort, ...(after ? { after } : {}) })
    return layout({
      kind: 'site', title: 'The market: Spinlings', description: 'One-of-a-kind Spinlings cards up for sparks or a swap. Buy them inside Claude Code.',
      path: '/market', origin: ctx.origin, cache: MINUTE_CACHE, now: ctx.now, css: SITE_CSS + MARKET_CSS + LOTS_CSS + RANKS_CSS,
      og: { title: 'The Spinlings market', description: 'One-of-a-kind cards up for sparks or a swap.' },
      body: marketBody(res, { ...(family ? { family } : {}), sort }, after !== undefined, catalogOf(ctx.db)),
    })
  }, 'browse')

  page('/u/:handle', async ctx => {
    const p = await profile(ctx.db, ctx.params.handle!, ctx.now)
    if (!p) return missing(ctx, 'No trainer by that name', 'Usernames can change once a week, so an old link may point nowhere.')
    const handle = text(p.handle, 40)
    const lead = p.team[0]
    const selling = await listingsByHandle(ctx.db, p.handle, ctx.now)
    return layout({
      kind: 'site', title: `${handle}'s camp: Spinlings`, description: `${handle}'s team and cards marked for trade.`,
      path: `/u/${p.handle}`, origin: ctx.origin, noindex: true, cache: MINUTE_CACHE, now: ctx.now,
      css: SITE_CSS + CAMP_CSS + PROFILE_CSS + (p.stats ? STATS_CSS : '') + (selling.length ? LOTS_CSS : ''),
      body: html`${placeStrip(lead?.family ?? 'fable')}
<section class="wrap profile">
<p class="pennant">${p.league} league</p>
<h1>${heading(`${handle}'s camp`)}</h1>
<p class="chips"><span class="ptag">${p.seenCount} species in their album</span></p>
</section>
${p.team.length ? teamCamp(p.team) : html`<div class="wrap"><p class="empty doze">${raw(spriteSvg(spriteFor({ form: regulars()[2]!, stage: 1 }), { cls: 'shut' }))}<span>No team saved right now. Everyone's off in the grass.</span></p></div>`}
<section class="wrap profile">
${p.stats ? html`<h2>${heading('Stats')}</h2>${statTiles(p.stats)}` : ''}
${selling.length ? html`<h2>${heading('On the market')}</h2><div class="stall">${lots(selling, [], { seller: false, catalog: catalogOf(ctx.db) })}</div><p class="more"><a href="/market">See the whole market</a></p>` : ''}
<h2>${heading('Pinned for trade')}</h2>
${p.forTrade.length ? html`<div class="board">${cardTiles(p.forTrade, { link: true })}</div>` : html`<p class="empty doze">${raw(spriteSvg(spriteFor(lead ?? { form: regulars()[2]!, stage: 1 }), { cls: 'shut' }))}<span>Nothing pinned for trade yet. Check back soon.</span></p>`}
<div class="cta">
<h2>${heading(`Trade with ${handle}`)}</h2>
<p>Type this inside Claude Code to see their cards and make an offer.</p>
${promptLine(`/spin trade ${handle}`, 'The trade command')}
<p class="duelask">Or try your team against theirs, just for fun.</p>
${promptLine(`/spin duel ${handle}`, 'The challenge command')}
<div class="newhere"><h3>New here?</h3>${installBlock('install', 'Install Spinlings first. Your own starter team hatches right away.')}</div>
</div>
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
      kind: 'site', title: `${name}: Spinlings`,
      description: `${name}, ${a(rarityWord(card))} ${describeCard(card)} in Spinlings.`,
      path: `/c/${card.id}`, origin: ctx.origin, noindex: true, cache: 'public, max-age=300', css: SITE_CSS + FULL_CSS + CARD_CSS, now: ctx.now,
      og: {
        title: `${name}, ${a(rarityWord(card))} ${describeCard(card)}`,
        description: `Level ${card.level}, genes ${geneScore(card.genes)}%${traits ? `, ${traits}` : ''}. Every Spinling is one of a kind. Find your own while Claude works.`,
        image: `${ctx.origin}/c/${card.id}.png`, imageAlt: `${name}, a pixel creature`,
      },
      body: html`${placeStrip(card.family)}
<section class="wrap cardpage">
${fullCard(card)}
<div class="cta"><p class="big">Every Spinling is one of a kind. Find your own while Claude works.</p>${installBlock('install')}</div>
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
      kind: 'site', title: 'A Spinling is waiting for you', description: `Someone sent you ${a(rarityWord(card))} ${describeCard(card)}. Claim it inside Claude Code.`,
      path: `/g/${code}`, origin: ctx.origin, noindex: true, css: SITE_CSS + GIFT_CSS, now: ctx.now,
      og: {
        title: 'A Spinling is waiting for you', description: `Someone sent you ${name}, ${a(rarityWord(card))} ${describeCard(card)}. Claim it inside Claude Code.`,
        image: `${ctx.origin}/c/${card.id}.png`, imageAlt: `${name}, a pixel creature`,
      },
      body: html`${placeStrip(card.family)}
<section class="wrap gift giftstall" data-giftstall>
<div class="giftstage" style="--fam:${FAMILY_COLOR[card.family]}">
<button class="present js-only" type="button" data-present aria-keyshortcuts="o" aria-label="A present for you. Unwrap it.">${raw(PRESENT)}<span class="fortag" aria-hidden="true">For you</span></button>
<div class="giftcard">${cardFace(card, { big: true, level: true, genes: true, traits: true })}</div>
<div class="giftmat" aria-hidden="true"></div>
<p class="tapme js-only" aria-hidden="true">Tap to unwrap <span class="kc1">o</span></p>
</div>
<div class="how">
<h1>${heading('A Spinling is waiting for you.')}</h1>
<p class="lede">Someone sent you ${name}, ${a(rarityWord(card).toLowerCase())} ${describeCard(card)}. It's yours once you claim it.</p>
<ol class="signposts">
<li><h2>Install Spinlings</h2>${installBlock('install')}</li>
<li><h2>Start a new Claude Code session</h2><p>Your own starter team hatches right away.</p></li>
<li><h2>Claim your gift</h2>${promptLine(`/spin claim ${code}`, 'The claim command')}</li>
</ol>
<p class="fine">Gift links last 14 days and work once.</p>
</div>
</section>`,
    })
  }, 'profile')

  page('/d/:code', async ctx => {
    const drop = await publicDrop(ctx.db, ctx.params.code!, ctx.now)
    if (!drop) return missing(ctx, 'No drop by that name', 'Check the code for typos. Some codes are one of a kind and have no page.')
    return layout({
      kind: 'site', title: `${drop.code}: a Spinlings drop`, description: dropLine(drop),
      path: `/d/${drop.code}`, origin: ctx.origin, cache: 'public, max-age=30', css: SITE_CSS + GIFT_CSS + DROP_CSS, now: ctx.now,
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
          title: 'This link has expired: Spinlings', heading: 'This link has expired', path: `/passkey/${kind}`, origin: ctx.origin, status: 410, now: ctx.now,
          lines: ['Passkey links work once and only for 10 minutes. Start again inside Claude Code with /spin devices.'],
        })
      }
      return passkeyBody(ctx, kind, ticket, data.options)
    }, 'profile')
  }

  page('/static/passkey.js', () => new Response(PASSKEY_JS, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': HOUR_CACHE },
  }))

  // Any other one-segment address (a typo, an old link): the "not here" page for a browser, and the
  // API's own JSON 404 for anything that did not ask for a page. Literal routes outrank this one, and
  // no API route lives one segment deep.
  page('/:anything', ctx => {
    if (!/\btext\/html\b/i.test(ctx.req.headers.get('accept') ?? '')) fail('not_found', 'Not found')
    return missing(ctx, 'No page by that name', 'Check the link for a typo.')
  })
}

/** The one "not here" page for everything unknown, gone or private: it never says which. */
function missing(ctx: Ctx, what: string, line: string, cache = MINUTE_CACHE): Response {
  return notice({
    title: `${what}: Spinlings`, heading: 'Nothing in this patch of grass.', path: ctx.url.pathname, origin: ctx.origin, status: 404, cache, now: ctx.now,
    lines: [`${what}. ${line}`],
    extra: html`<p><a class="back" href="/">Back to the meadow</a></p>`,
  })
}

/** A family place (or the meadow) as a strip of scenery at the top of a page. */
function placeStrip(f: Family): Raw {
  const [sky, ground, shade] = PLACE[f]
  return html`<div class="place" style="--psky:${sky};--pground:${ground};--pshade:${shade}" aria-hidden="true">${raw(placeStripSvg())}</div>`
}

// ---- postcards -----------------------------------------------------------------------------------

function postcardPage(ctx: Ctx, m: NonNullable<ReturnType<typeof meet>>, rule: DailyRule): Response {
  const name = text(cardName(m.card), 40)
  const fam = FAMILY_INFO[m.card.family].name
  const rarity = m.card.rarity
  const e = `?e=${encodeURIComponent(m.entry)}`
  return layout({
    kind: 'site', title: `${name} came out of the grass: Spinlings`, description: `A ${rarity} ${fam} creature from Spinlings, the creature card game inside Claude Code.`,
    path: `/w/${m.seed}${e}`, origin: ctx.origin, noindex: true, cache: DAY_CACHE, hour: m.hour, now: ctx.now, css: SITE_CSS + POSTCARD_CSS,
    og: {
      title: `${name} met me at ${m.hour}`, description: `A ${rarity} ${fam} creature from Spinlings, the creature card game inside Claude Code.`,
      image: `${ctx.origin}/w/${m.seed}.png${e}`, imageAlt: `${name}, a pixel creature standing in the grass`,
    },
    body: html`<section class="postcard" aria-labelledby="pc-h">
<div class="pcsky"><div class="wrap">
<h1 id="pc-h">${pixelHeading(`${name} came out of the grass.`)}</h1>
<p class="lede">A friend met this ${rarity} ${fam} creature at ${m.hour} on ${RULE_INFO[rule].name}.</p>
<p class="meet"><a class="pbtn" href="/"><span class="face">Meet your own</span></a></p>
</div></div>
<div class="pcscene">
<div class="lay peaks" aria-hidden="true">${raw(peaksSvg())}</div>
<div class="lay hill" aria-hidden="true">${raw(hillSvg())}</div>
<div class="star${m.card.foil ? ' foil' : ''}">${raw(spriteSvg(spriteFor(m.card), { label: name }))}</div>
<div class="lay grass" aria-hidden="true">${raw(grassSvg())}</div>
</div>
<div class="pcground"><div class="wrap">${installBlock('install')}</div></div>
</section>`,
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
  const stage = d.ended ? 3 : d.supply ? Math.min(2, Math.floor((d.redeemed / d.supply) * 3)) : Math.min(2, Math.floor(d.redeemed / 500))
  const fam = egg?.family ?? 'fable'
  const shade = egg ? raw(shadowSvg(spriteFor({ form: promoForm(egg), stage: egg.rarity === 'legendary' ? 3 : 1 }), 'eggshadow')) : ''
  return html`${placeStrip(fam)}
<section class="wrap gift drop">
<div class="nestbox" style="--fam:${FAMILY_COLOR[fam]}">
${d.ended
    ? html`<div class="egg shell" role="img" aria-label="An empty eggshell">${raw(eggSvg(3))}</div>`
    : html`<button class="egg js-only" type="button" data-egg data-crack="${stage}" aria-label="A creature still in its egg. Tap it.">${raw(eggSvg(stage))}</button><div class="egg nojs" role="img" aria-label="A creature still in its egg">${raw(eggSvg(stage))}</div>`}
<div class="nest" aria-hidden="true"></div>
${egg && !d.ended ? html`<div class="peek" aria-hidden="true">${shade}</div>` : ''}
</div>
<div class="how">
<p class="k">Drop code</p>
<h1 class="code">${d.code}</h1>
<p class="lede">${dropLine(d)}${egg ? ' Everyone gets the same creature, but each one hatches with its own look.' : ''}${d.bound ? ' It stays in your collection: drop cards cannot be traded or gifted.' : ''}</p>
<p class="fence"><b>${d.redeemed.toLocaleString('en-US')}</b> hatched so far${left !== null ? html`, <b>${left.toLocaleString('en-US')}</b> left in the nest` : ''}.</p>
${d.ended
    ? html`<p class="ended">This drop has ended. There will be others.</p>${installBlock('install')}`
    : html`<ol class="signposts">
<li><h2>Install Spinlings</h2>${installBlock('install')}</li>
<li><h2>Redeem the code</h2>${promptLine(`/spin redeem ${d.code}`, 'The redeem command')}</li>
</ol>`}
</div>
</section>`
}

/** An egg, 16 x 20, with cracks for stage 0-2, and a broken shell at 3. */
function eggSvg(stage: number): string {
  let shell = '', crack = ''
  for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) {
    const nx = (x - 7.5) / 7.5, ny = (y - 11) / (y < 11 ? 11 : 9)
    if (nx * nx + ny * ny < 1 && !(stage === 3 && y < 9)) shell += `M${x} ${y}h1v1h-1z`
  }
  const cracks = [[], [[7, 6], [8, 7], [7, 8]], [[7, 6], [8, 7], [7, 8], [6, 9], [9, 6], [10, 5], [5, 10]], [[2, 9], [4, 10], [6, 9], [8, 10], [10, 9], [12, 10], [13, 9]]][stage] ?? []
  for (const [x, y] of cracks) crack += `M${x} ${y}h1v1h-1z`
  return `<svg class="eggart" viewBox="0 0 16 20" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path class="es" d="${shell}"/><path class="ec" d="${crack}"/><g class="extra"></g></svg>`
}

const PRESENT = `<svg class="presentart" viewBox="0 0 16 15" shape-rendering="crispEdges" focusable="false"><g class="lid"><path class="pr" d="M5 0h2v1h-2zM9 0h2v1h-2zM4 1h1v2h-1zM7 1h2v3h-2zM11 1h1v2h-1zM5 3h2v1h-2zM9 3h2v1h-2z"/><path class="pl" d="M1 4h6v2h-6zM9 4h6v2h-6z"/><path class="pr" d="M7 4h2v3h-2z"/><path class="pld" d="M1 6h6v1h-6zM9 6h6v1h-6z"/></g><g class="box"><path class="pb" d="M2 7h5v7h-5zM9 7h5v7h-5z"/><path class="pbd" d="M2 14h5v1h-5zM9 14h5v1h-5zM3 8h1v1h-1zM12 11h1v1h-1z"/><path class="pr" d="M7 7h2v8h-2z"/></g></svg>`

// ---- passkeys ----------------------------------------------------------------------------------

const PASSKEY_COPY = {
  add: {
    title: 'Save your collection with a passkey',
    lede: 'A passkey lets you play with this collection on another computer. No email and no password: your device or password manager keeps it.',
    warning: 'You are saving a passkey for Spinlings on your own computer. If someone sent you this link, close this page: continuing would tie your passkey to their account.',
    button: 'Save a passkey',
    done: 'Saved. You can close this page.',
  },
  signin: {
    title: 'Sign in with your passkey',
    lede: 'Bring your Spinlings collection to this computer with the passkey you saved before.',
    warning: 'You are signing in to Spinlings on your own computer. If someone sent you this link, close this page: continuing would give them your account.',
    button: 'Sign in with a passkey',
    done: 'Signed in. You can close this page.',
  },
} as const

let KEYHOLDER = ''
function keyholder(): string {
  if (!KEYHOLDER) {
    const form = regulars()[0]!
    KEYHOLDER = spriteSvg(spriteFor({ form, stage: 1 }))
  }
  return KEYHOLDER
}

function passkeyBody(ctx: Ctx, kind: 'add' | 'signin', ticket: string, options: unknown): Response {
  const copy = PASSKEY_COPY[kind]
  const host = new URL(ctx.origin).host
  return layout({
    title: `${copy.title}: Spinlings`, description: copy.lede, path: `/passkey/${kind}`, origin: ctx.origin,
    noindex: true, kind: 'passkey', css: PASSKEY_CSS, now: ctx.now,
    body: html`<section class="wrap pk" id="passkey" data-kind="${kind}" data-ticket="${ticket}" data-options="${JSON.stringify(options)}" data-state="ready">
<p class="site">You are on <strong class="host">${host}</strong></p>
<h1>${copy.title}</h1>
<p class="lede">${copy.lede}</p>
<div class="warn" role="note"><p><strong>Only continue if you opened this page yourself.</strong></p><p>${copy.warning}</p></div>
<button id="go" class="go" type="button">${copy.button}</button>
<p id="status" class="status" role="status" aria-live="polite"></p>
<div class="keyholder" aria-hidden="true">${raw(keyholder())}<svg class="pkey" viewBox="0 0 9 5" shape-rendering="crispEdges"><path d="M0 1h3v3h-3zM3 2h6v1h-6zM6 3h1v1h-1zM8 3h1v2h-1z"/><path fill="#14121c" d="M1 2h1v1h-1z"/></svg><p>${copy.done}</p></div>
<noscript><p class="status">This page needs JavaScript to talk to your passkey.</p></noscript>
</section>`,
  })
}

// ---- page styles -------------------------------------------------------------------------------

/** Shared by the other script pages: a calm surface under a place strip. */
const SITE_CSS = PLACE_CSS + `
main{display:block;background:#1c1a26;color:#f4f2fb;padding-bottom:var(--s6)}
main .soft{color:#c9c3d6}
main :focus-visible{outline-color:#fffdf5}
.place{margin-bottom:var(--s4)}
.place .placeart{left:50%;left:round(down,50%,1px);transform:translateX(-50%);width:calc(480 * var(--ap));height:calc(64 * var(--ap))}
.cta{margin-top:var(--s5)}
.cta .big{font-size:1.25rem;font-weight:700;max-width:40ch}
.install{margin-top:var(--s3);max-width:760px}
.install .label{font-weight:600;margin-bottom:var(--s2)}
.install .ask{margin-top:var(--s2);font-size:.9375rem;color:#c9c3d6}
.chip{display:inline-flex;padding:3px 10px 4px;background:#2e2a3d;font-size:.875rem;font-weight:600}
.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:var(--s3)}
.cardlink{display:block;color:inherit;text-decoration:none}
.empty{padding:var(--s3);background:#26222f;color:#c9c3d6}
.lede{margin-top:var(--s3);font-size:1.25rem;line-height:1.5;color:#e2deee}
`

const PROFILE_CSS = `
main{background:#0f1626}
.profile{position:relative}
.profile h1{font-size:clamp(2rem,1.4rem + 2.4vw,3rem);font-weight:800;line-height:1.15;overflow-wrap:anywhere}
.pennant{position:absolute;right:32px;top:-24px;margin:0;padding:8px 16px 18px;background:#c2493d;color:#fffdf5;font-weight:800;clip-path:polygon(0 0,100% 0,100% 100%,50% 75%,0 100%)}
@media (max-width:600px){.pennant{position:static;display:inline-block;margin-bottom:var(--s2)}}
.chips{display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s4)}
.ptag{position:relative;display:inline-block;padding:5px 10px 5px;background:#f1e6cf;color:#2a1d18;font-size:.875rem;font-weight:700;rotate:-2deg;box-shadow:0 3px 0 #0000004d}
.ptag::before{content:"";position:absolute;left:50%;top:-4px;width:6px;height:6px;margin-left:-3px;background:#c2493d}
.fireside{margin-top:0}
.camper{width:var(--cs);height:var(--cs)}
.camper:nth-child(3){left:calc(50% + var(--fx) + 4 * var(--ap));z-index:3}
.profile h2{margin:var(--s5) 0 var(--s3);color:#fdf6ec;--hsh:#000;--sho:.6}
.profile h3{margin:var(--s5) 0 var(--s2);font-size:1.125rem}
.board{padding:var(--s4) var(--s3);background:#6b4a33;box-shadow:inset 0 0 0 4px #4a3326}
.empty.doze{display:flex;align-items:center;gap:var(--s3);max-width:none;padding:var(--s3) var(--s4);background:#1c2333;color:#c9c3d6}
.empty.doze .spr{width:64px;height:64px;flex:none}
.cta .prompt{margin-top:var(--s3);max-width:760px}
.profile .more{margin-top:var(--s3)}
.duelask{margin-top:var(--s4)}
.newhere{margin-top:var(--s5);padding-top:var(--s4);border-top:2px dashed #2e3446}
.newhere h3{margin-top:0}
`

const CARD_CSS = `
.cardpage{position:relative;max-width:1080px;margin-top:calc(-48 * var(--ap))}
.cardpage .full{align-items:start}
.bigcard{padding-top:0;filter:drop-shadow(0 14px 0 #0000004d)}
.cardpage .plaque{margin-top:calc(36 * var(--ap))}
@media (max-width:859px){.cardpage .plaque{margin-top:0}}
`

const GIFT_CSS = `
.gift{position:relative;display:grid;gap:var(--s4);align-items:start;margin-top:calc(-34 * var(--ap))}
.gift .how{padding-top:calc(30 * var(--ap))}
@media (max-width:859px){.gift .how{padding-top:0}}
@media (min-width:860px){.gift{grid-template-columns:minmax(220px,300px) 1fr;gap:var(--s5)}}
.giftstage{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-height:300px}
@media (min-width:860px){.giftstage{min-height:460px;position:sticky;top:calc(var(--hdr) + 16px)}}
.present{position:relative;z-index:1;width:160px;height:150px;padding:0;border:0;background:none;cursor:pointer;transform-origin:50% 100%}
html.js .giftstall:not(.open) .present{animation:pwob 3s steps(1) 1s infinite}
@keyframes pwob{0%,12%,100%{transform:none}2%,6%{transform:translateX(4px) rotate(2deg)}4%,8%{transform:translateX(-4px) rotate(-2deg)}}
.present:hover .presentart{animation:none}
.presentart{width:160px;height:150px;overflow:visible}
.presentart .pb{fill:var(--fam)}.presentart .pbd{fill:color-mix(in srgb,var(--fam) 65%,#000)}.presentart .pl{fill:color-mix(in srgb,var(--fam) 80%,#fff)}.presentart .pld{fill:color-mix(in srgb,var(--fam) 70%,#000)}.presentart .pr{fill:#f2d36b}
.fortag{position:absolute;right:-24px;top:24px;padding:2px 8px 3px;background:#f1e6cf;color:#2a1d18;font-size:.8125rem;font-weight:700;transform:rotate(8deg)}
.tapme{position:relative;z-index:1;display:flex;align-items:center;gap:var(--s2);margin-top:var(--s3);font-size:.9375rem;font-weight:700;color:#e2deee}
.tapme .kc1{color:#1d1726}
.giftmat{position:relative;z-index:0;width:min(300px,100%);height:calc(6 * var(--ap));margin-top:-6px;background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--fam,#a874e8) 55%,#1d1726) 0 calc(4 * var(--ap)),var(--fam,#a874e8) 0 calc(6 * var(--ap)),color-mix(in srgb,var(--fam,#a874e8) 55%,#1d1726) 0 calc(10 * var(--ap)));box-shadow:inset 0 calc(-1 * var(--ap)) 0 #0004}
.giftcard{position:relative;z-index:1;width:min(300px,100%);filter:drop-shadow(0 12px 0 #0000004d)}
.giftcard .cf{--cs:10px}
html.js .giftstall:not(.open) .giftcard{display:none}
html.js .giftstall.open .present,html.js .giftstall.open .tapme{display:none}
.how h1{font-size:clamp(2rem,1.4rem + 2.4vw,3rem);font-weight:800;line-height:1.15}
.signposts{list-style:none;margin:var(--s4) 0 0;padding:0;display:grid;gap:var(--s4)}
.signposts>li{position:relative;padding:var(--s3) var(--s3) var(--s3) var(--s4);background:#6b4a33;color:#fbf1e2;box-shadow:inset 0 -4px 0 #4a3326}
.signposts>li::before{content:"";position:absolute;left:12px;top:0;bottom:-16px;width:6px;background:#4a3326}
.signposts h2{font-size:1.125rem;font-weight:800}
.signposts p{margin-top:var(--s1)}
.signposts .install{margin-top:var(--s2)}
.signposts .install .label{display:none}
.signposts .install .ask{color:#e6d3bd}
.signposts .prompt{margin-top:var(--s2)}
.fine{margin-top:var(--s4);font-size:.9375rem;color:#c9c3d6}
`

const DROP_CSS = `
.nestbox{position:relative;display:grid;place-items:center;min-height:280px}
.egg{position:relative;z-index:2;width:128px;height:160px;padding:0;border:0;background:none;cursor:pointer}
.egg svg{width:128px;height:160px}
.eggart .es{fill:#f4ecdc}.eggart .ec{fill:#2a1d18}
.egg.wob{animation:wob .6s steps(1)}
html.js .egg.nojs{display:none}
.nest{position:absolute;bottom:56px;width:200px;height:40px;background:#7a5638;box-shadow:inset 0 -8px 0 #5a3c2a;clip-path:polygon(0 0,100% 0,92% 100%,8% 100%)}
.peek{position:absolute;bottom:120px;opacity:0}
.drop .k{font-size:.875rem;color:#c9c3d6}
.drop .code{font-family:var(--mono);font-size:clamp(2rem,1.4rem + 2.4vw,3rem);letter-spacing:.04em;overflow-wrap:anywhere}
.fence{margin-top:var(--s3);padding:var(--s2) var(--s3);background:#6b4a33;color:#fbf1e2;font-size:1.0625rem;display:inline-block}
.fence b{font-size:1.25rem;font-variant-numeric:tabular-nums}
.ended{margin-top:var(--s3);padding:var(--s3);background:#26222f}
@keyframes wob{0%{transform:translateX(4px)}25%{transform:translateX(0)}50%{transform:translateX(-4px)}75%{transform:translateX(0)}}
`

const POSTCARD_CSS = `
main{background:var(--sky1);padding-bottom:0;color:var(--ink)}
.postcard{position:relative}
.pcsky{padding:var(--s5) 0 var(--s4);background:var(--sky1)}
.pcsky h1{color:var(--ink)}
.pcsky .lede{color:var(--ink)}
.meet{margin-top:var(--s4)}
.meet .pbtn{text-decoration:none}
.pcscene{position:relative;height:calc(76 * var(--ap));background:var(--sky3);overflow:hidden}
.pcscene::before{content:"";position:absolute;left:0;right:0;top:calc(26 * var(--ap));bottom:0;background:var(--sky4)}
.pcscene .lay{position:absolute;left:0;right:0;overflow:hidden}
.pcscene .lay svg{position:absolute;left:50%;left:round(down,50%,1px);bottom:0;width:calc(var(--aw) * var(--ap));height:calc(var(--ah) * var(--ap));transform:translateX(-50%)}
.pcscene .lay.peaks{top:0;height:calc(48 * var(--ap))}
.pcscene .lay.hill{top:calc(40 * var(--ap));height:calc(36 * var(--ap))}
.pcscene .lay.hill::after{content:"";position:absolute;left:0;right:0;bottom:0;height:calc(6 * var(--ap));background:var(--hill)}
.pcscene .lay.grass{bottom:0;height:calc(16 * var(--ap));z-index:3}
.pcscene .star{position:absolute;left:50%;bottom:calc(12 * var(--ap));z-index:2;transform:translateX(-50%)}
.pcscene .star .spr{width:128px;height:128px}
@media (min-width:1024px){.pcscene .star .spr{width:192px;height:192px}}
.pcground{background:var(--g3);color:#fffdf5;padding:var(--s4) 0 var(--s5)}
.pcground .install{margin-top:0}
.pcground .ask{color:#fffdf5}
`

const PASSKEY_CSS = `
main{display:block;background:var(--paper);color:var(--pink)}
.pk{padding-top:var(--s5);padding-bottom:var(--s6)}
.pk>*{max-width:640px}
.site{display:inline-block;margin-bottom:var(--s3);padding:6px 12px 7px;background:var(--pline);font-size:.9375rem}
.host{font-family:var(--mono);font-size:1rem}
.pk h1{font-size:clamp(1.875rem,1.4rem + 2vw,2.625rem);font-weight:800;line-height:1.15}
.pk .lede{margin-top:var(--s3);font-size:1.1875rem;color:var(--psoft)}
.warn{margin-top:var(--s4);padding:var(--s3);border:2px solid #c2493d;background:color-mix(in srgb,#c2493d 10%,var(--paper))}
.warn p+p{margin-top:var(--s1)}
.go{margin-top:var(--s4);min-height:48px;padding:0 var(--s4) 4px;border:2px solid #1d1726;border-bottom-width:6px;background:#fffdf5;color:#1d1726;font:700 1.0625rem/1 var(--sans);cursor:pointer}
.go:active{transform:translateY(4px);border-bottom-width:2px;margin-bottom:4px}
.go:disabled{opacity:.5;cursor:default}
.status{margin-top:var(--s3);min-height:1.6em;color:var(--psoft)}
.pk[data-state=done] .status{color:var(--pink);font-weight:600}
.pk[data-state=error] .status{color:#b23a2e}
@media (prefers-color-scheme:dark){.pk[data-state=error] .status{color:#f08a7e}}
.keyholder{display:none;align-items:center;gap:var(--s3);margin-top:var(--s4)}
.pk[data-state=done] .keyholder{display:flex}
.keyholder .spr{width:64px;height:64px}
.keyholder .pkey{width:36px;height:20px;margin-left:-20px;fill:#f2b33d}
.keyholder p{font-weight:700}
`
