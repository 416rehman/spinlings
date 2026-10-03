// The private browser collection: the public shell contains no player data. Its own script signs
// in with a passkey and reads the same bearer-authenticated API as the mod.
import type { Api } from './app.ts'
import { parseRequest, SchemaError } from '../../plugin/hooks/core/schemas.ts'
import { stmt } from './db.ts'
import { fail, json } from './http.ts'
import { passkeyPage, startPoll } from './game/auth.ts'
import { rpIdOf } from './game/passkeys.ts'
import { publicCardById } from './pages-data.ts'
import { colourPaths } from './pages-sprite.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { heading, html, layout } from './pages-html.ts'
import { ACCOUNT_JS } from '../static/account.ts'

export function browserAccount(api: Api): void {
  api.add({ method: 'GET', path: '/account', public: true, handler: ctx => layout({
    kind: 'account', title: 'Your collection · Spinlings', description: 'Your Spinlings, stats and place on every board.',
    path: '/account', origin: ctx.origin, now: ctx.now, noindex: true, css: ACCOUNT_CSS,
    body: html`<section class="wrap accountpage" id="account">
<div class="accounthead"><h1>${heading('Your collection')}</h1><button class="pbtn" id="signout" hidden>Sign out</button></div>
<div id="signedout"><p class="lede">Bring your Spinlings here with your saved passkey.</p>
<button class="pbtn" id="signin">Sign in with a passkey</button>
<p class="fine">Save a passkey in Claude Code first: open Spinlings, then Community → Your profile → Passkey &amp; devices.</p></div>
<p id="account-status" role="status" aria-live="polite"></p>
<div id="dashboard" hidden>
<nav class="accountnav" aria-label="Your collection"><a href="#myteam">Team</a><a href="#mystats">Stats</a><a href="#myranks">Rankings</a><a href="#mycards">Cards</a></nav>
<p id="myhandle" class="lede"></p><div id="mybalance" class="accountstats"></div>
<h2 id="myteam">Your team</h2><div id="teamcards" class="accountcards"></div>
<h2 id="mystats">Your stats</h2><div id="stats" class="accountstats"></div>
<h2 id="myranks">Your rankings</h2><div class="accountfilters"><label>Board <select id="board"><option value="rating">Rating</option><option value="beaten">Players beaten</option><option value="duelWins">Duel wins</option><option value="species">Species collected</option><option value="mythics">Mythics found</option><option value="sales">Market sales</option></select></label>
<label>When <select id="period"><option value="all">All time</option><option value="season">This season</option></select></label></div>
<p id="rank" role="status" aria-live="polite"></p><p class="fine">Board places use the last midnight UTC snapshot. Your stats above are current.</p>
<a id="publicboard" href="/boards">See this leaderboard</a>
<h2 id="mycards">Your cards</h2><p id="inventory"></p>
<div class="accountfilters"><label>Family <select id="family"><option value="">All families</option><option value="haiku">✿ Haiku</option><option value="sonnet">≈ Sonnet</option><option value="opus">☀ Opus</option><option value="fable">☾ Fable</option></select></label>
<label>Rarity <select id="rarity"><option value="">All rarities</option><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option></select></label></div>
<div id="collection" class="accountcards"></div><button class="pbtn" id="more" hidden>Load more cards</button>
<p class="fine">Open packs, change your team and trade in Claude Code. This page shows the same online collection.</p>
<button class="pbtn" id="refresh">Refresh collection</button></div>
<noscript><p>Enable JavaScript to sign in with your passkey and see your collection.</p></noscript>
</section>`,
  }) })
  api.add({ method: 'GET', path: '/static/account.js', public: true, handler: () => new Response(ACCOUNT_JS, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  }) })
  api.add({ method: 'GET', path: '/c/:id/art.svg', public: true, handler: async ctx => {
    const card = await publicCardById(ctx.db, ctx.params.id!)
    if (!card) fail('not_found', 'Not found')
    return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${colourPaths(spriteFor(card))}</svg>`, {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=300' },
    })
  } })
  api.add({ method: 'POST', path: '/account/signin/start', public: true, limit: 'passkey', handler: async ctx => {
    try { parseRequest('authStart', ctx.body) } catch (err) {
      if (err instanceof SchemaError) fail('bad_request', 'Malformed sign-in request')
      throw err
    }
    const started = await startPoll(ctx, 'signin')
    const ticket = new URL(started.url).searchParams.get('t')!
    const page = (await passkeyPage(ctx.db, { kind: 'signin', ticket, now: ctx.now, rpId: rpIdOf(ctx.origin) }))!
    return json({ ticket, pollId: started.pollId, options: page.options })
  } })
  api.add({ method: 'DELETE', path: '/account/signout', touch: false, handler: async ctx => {
    await ctx.db.batch([stmt('DELETE FROM sessions WHERE id = ? AND player_id = ?', ctx.sessionId, ctx.player.id)])
    return json({ ok: true })
  } })
}

const ACCOUNT_CSS = `
.accountpage{max-width:1100px;padding-top:var(--s5);padding-bottom:var(--s5);color:var(--pink)}
.account{background:var(--paper)}.accounthead,.accountnav,.accountfilters{display:flex;flex-wrap:wrap;align-items:center;gap:16px}
.accounthead{justify-content:space-between}.accountpage h2{margin:32px 0 16px}.accountpage p{margin:16px 0}
.accountnav{margin:24px 0}.accountnav a{font-weight:700}.accountpage [hidden]{display:none!important}
.accountfilters{margin:16px 0}.accountfilters label{display:flex;align-items:center;gap:8px}
.accountpage select{font:inherit;color:var(--pink);background:var(--paper);border:2px solid var(--psoft);border-radius:6px;padding:8px;max-width:100%}
.accountpage .pbtn{font:inherit;font-weight:700;border:2px solid var(--psoft);border-radius:8px;padding:12px 16px;color:var(--pink);background:var(--paper);align-items:center}.accountpage .pbtn:disabled{opacity:.5;cursor:wait}
.accountstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.accountstat{padding:12px;border:2px solid var(--psoft);border-radius:8px}.accountstat b{display:block;font-size:24px}
.accountstat span{color:var(--psoft)}.accountcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}
.accountcard{min-width:0;border:2px solid var(--rar);border-radius:8px;padding:12px;background:var(--paper)}
.accountcard img{display:block;width:96px;height:96px;image-rendering:pixelated;margin:auto}.accountcard a{display:block;font-weight:700;overflow-wrap:anywhere;text-align:center}
.accountcard p{font-size:14px;margin:8px 0}.accountcard summary{cursor:pointer}.accountcard details p{overflow-wrap:anywhere}
#account-status:empty{display:none}#rank{font-size:20px;font-weight:700}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--pink);outline-offset:4px}
@media(max-width:400px){.accountcards{grid-template-columns:repeat(2,minmax(0,1fr))}.accountcard{padding:8px}.accountstat b{font-size:20px}}
`
