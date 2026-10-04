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
import { CARD_HELP } from './card-guide.ts'

export function browserAccount(api: Api): void {
  api.add({ method: 'GET', path: '/account', public: true, handler: ctx => layout({
    kind: 'account', title: 'Your collection · Spinlings', description: 'Your Spinlings, stats and place on every board.',
    path: '/account', origin: ctx.origin, now: ctx.now, noindex: true, css: ACCOUNT_CSS,
    body: html`<section class="wrap accountpage" id="account">
<div class="accounthead"><h1>${heading('Your collection')}</h1><button class="pbtn" id="signout" hidden>Sign out</button></div>
<div id="signedout"><p class="lede">Bring your Spinlings here with your saved passkey.</p>
<button class="pbtn" id="signin">Sign in with a passkey</button>
<p class="fine">Save a passkey in Claude Code first: open Spinlings, then Community → Profile → Passkey &amp; devices.</p></div>
<p id="account-status" role="status" aria-live="polite"></p>
<div id="dashboard" hidden>
<nav class="accountnav" aria-label="Your collection"><a href="#myteam">Team</a><a href="#mystats">Stats</a><a href="#myranks">Rankings</a><a href="#mycards">Cards</a></nav>
<div class="accountidentity"><p id="myhandle" class="lede"></p><button type="button" class="pbtn" id="username-change" aria-controls="username-form" aria-expanded="false">Change username</button></div>
<form id="username-form" hidden novalidate><label for="username">Username</label><div class="accountfilters">
<input id="username" name="handle" type="text" required minlength="1" maxlength="40" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="username-rules username-note username-status">
<button type="submit" class="pbtn" id="username-save">Save username</button><button type="button" class="pbtn" id="username-cancel">Cancel</button></div>
<p id="username-rules" class="fine">1–40 letters, numbers, _ or -. Saved in lowercase.</p></form>
<p id="username-note" class="fine">Your account and passkeys stay the same.</p><p id="username-status" role="status" aria-live="polite"></p>
<div id="mybalance" class="accountstats"></div>
<h2 id="myteam">Your team</h2><div id="teamcards" class="accountcards"></div>
<h2 id="mystats">Your stats</h2><div id="stats" class="accountstats"></div>
<h2 id="myranks">Your rankings</h2><div class="accountfilters"><label>Board <select id="board"><option value="rating">Rating</option><option value="beaten">Players beaten</option><option value="duelWins">Duel wins</option><option value="species">Species collected</option><option value="mythics">Mythics found</option><option value="sales">Market sales</option></select></label>
<label>When <select id="period"><option value="all">All time</option><option value="season">This season</option></select></label></div>
<p id="rank" role="status" aria-live="polite"></p><p class="fine">Board places use the last midnight UTC snapshot. Your stats above are current.</p>
<a id="publicboard" href="/boards">See this leaderboard</a>
<h2 id="mycards">Your cards</h2><p id="inventory"></p>
<form id="card-search" role="search"><div class="accountfilters cardbrowse"><label class="cardquery" for="q">Search cards<input id="q" type="search" maxlength="40" placeholder="Creature name" autocomplete="off"></label><button type="submit" class="pbtn">Search</button>
<label for="family">Family<select id="family"><option value="">All families</option><option value="haiku">✿ Haiku</option><option value="sonnet">≈ Sonnet</option><option value="opus">☀ Opus</option><option value="fable">☾ Fable</option></select></label>
<label for="rarity">Rarity<select id="rarity"><option value="">All rarities</option><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option></select></label>
<label for="sort">Sort<select id="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option><option value="rarity">Rarest first</option><option value="level">Highest level</option><option value="atk">Highest Attack</option><option value="def">Highest Defense</option><option value="spd">Highest Speed</option><option value="hp">Highest HP</option><option value="genes">Best genes</option></select></label></div>
<details class="morefilters" id="morefilters"><summary>More filters</summary><div class="accountfilters cardbrowse">
<label for="trait">Trait<select id="trait"><option value="">Any trait</option>${Object.entries(CARD_HELP.traits).map(([id,trait]) => html`<option value="${id}">${trait.name}</option>`)}</select></label>
<label for="finish">Finish<select id="finish"><option value="">Any finish</option><option value="foil">Foil</option><option value="shiny">Shiny</option><option value="both">Foil &amp; shiny</option></select></label>
<label for="scope">Show<select id="scope"><option value="">All cards</option><option value="team">On my team</option><option value="forTrade">Marked for trade</option><option value="available">Not held</option></select></label></div></details>
<button type="button" class="pbtn" id="filters-reset">Reset filters</button></form>
<p id="collection-status" role="status" aria-live="polite"></p>
<div id="collection" class="accountcards" aria-busy="false"></div><button class="pbtn" id="more" hidden>Load more cards</button>
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
.account{background:var(--paper)}.accounthead,.accountnav,.accountfilters,.accountidentity{display:flex;flex-wrap:wrap;align-items:center;gap:16px}
.accounthead{justify-content:space-between}.accountpage h2{margin:32px 0 16px}.accountpage p{margin:16px 0}
.accountnav{margin:24px 0}.accountnav a{font-weight:700}.accountpage [hidden]{display:none!important}
.accountfilters{margin:16px 0}.accountfilters label{display:flex;align-items:center;gap:8px;min-width:0}
.accountpage select,.accountpage input{font:inherit;color:var(--pink);background:var(--paper);border:2px solid var(--psoft);border-radius:6px;padding:8px;max-width:100%}
.accountidentity{margin-top:16px}.accountidentity #myhandle{margin:0;overflow-wrap:anywhere;min-width:0}.accountpage input{box-sizing:border-box;width:24ch;min-width:0}.accountpage input[aria-invalid="true"]{border-color:var(--pink)}
.accountpage .pbtn{font:inherit;font-weight:700;border:2px solid var(--psoft);border-radius:8px;padding:12px 16px;color:var(--pink);background:var(--paper);align-items:center}.accountpage .pbtn:disabled{opacity:.5;cursor:wait}
.accountstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.accountstat{padding:12px;border:2px solid var(--psoft);border-radius:8px}.accountstat b{display:block;font-size:24px}
.accountstat span{color:var(--psoft)}.accountcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:24px;align-items:start}
.accountcard{position:relative;min-width:0;background:var(--paper)}.accountcard .cf{width:100%;box-sizing:border-box}
.accountcard img{display:block;width:96px;height:96px;image-rendering:pixelated;margin:auto}.accountcard a{display:block;font-weight:700;overflow-wrap:anywhere;text-align:center}
.accountcard .cf-name{overflow:visible;text-overflow:clip;white-space:normal}.accountcard .cf-art{padding:12px 0;box-sizing:border-box}
.accountcard p{font-size:14px;margin:8px 0}.accountcard summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px}.accountcard summary::before{content:'＋'}.accountcard details[open]>summary::before{content:'−'}
.accountplaque{padding:8px 12px 12px;border:2px solid var(--psoft);border-top:0}.cardstats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px}
.cardtraits{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.cardhint-label{font:inherit;font-size:14px;font-weight:700;color:var(--pink);background:transparent;border:0;min-height:44px;padding:4px 0;text-decoration:underline dotted;text-underline-offset:4px;text-align:left;cursor:help;overflow-wrap:anywhere}
.cardtraits .cardhint-label{border:1px solid var(--psoft);border-radius:16px;padding:4px 10px;cursor:pointer}
.accountcard .cardhint-tip{position:absolute;left:0;right:0;z-index:5;margin:0;padding:12px;background:var(--pink);color:var(--paper);border:2px solid var(--psoft);font-size:14px;line-height:1.5;overflow-wrap:anywhere;box-shadow:0 4px 0 #0002}
.carddetails{border-top:1px solid var(--psoft)}.carddetails .cardhint{display:inline-block;margin-right:12px}.carddetails p{overflow-wrap:anywhere}
.cardbrowse{align-items:end;gap:12px}.cardbrowse label{display:flex;flex-direction:column;align-items:start;gap:4px;flex:1 1 130px}.cardbrowse select,.cardbrowse input{width:100%;box-sizing:border-box}.cardbrowse .cardquery{flex:2 1 180px}.morefilters{margin:16px 0}.morefilters>summary{cursor:pointer;min-height:44px;display:list-item}
#account-status:empty,#username-status:empty{display:none}#rank{font-size:20px;font-weight:700}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--pink);outline-offset:4px}
@media(max-width:400px){.accountcards{grid-template-columns:minmax(0,1fr)}.accountstat b{font-size:20px}.cardbrowse label{flex-basis:100%}.accountfilters select{max-width:100%}}
`
