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
<div class="accounthead"><h1>${heading('Your collection')}</h1></div>
<div id="signedout"><span class="accountwelcome" aria-hidden="true">✦</span><h2>A home for your Spinlings.</h2><p class="lede">Your creatures, team and progress — all in one place.</p>
<button class="pbtn" id="signin">Sign in with a passkey</button>
<details class="accountsigninhelp"><summary>Need a passkey?</summary><p class="fine">Save one in Claude Code: open Spinlings, then Community → Profile → Passkey &amp; devices.</p></details></div>
<p id="account-status" role="status" aria-live="polite"></p>
<div id="dashboard" hidden>
<div class="accountprofile"><div class="accountidentity"><div id="profile-art" aria-hidden="true"></div><div><p class="accounteyebrow">Your Spinlings</p><div class="accountname"><p id="myhandle" class="lede"></p><button type="button" class="accountedit" id="username-change" aria-label="Change username" title="Change username" aria-controls="username-form" aria-expanded="false">✎</button></div></div></div>
<div class="accountactions"><button type="button" class="accountquiet" id="refresh" title="Refresh collection">↻ Refresh</button><button class="accountquiet" id="signout" hidden>Sign out</button></div>
<div id="mybalance" class="accountbalance"></div></div>
<form id="username-form" hidden novalidate><label for="username">Username</label><div class="accountfilters">
<input id="username" name="handle" type="text" required minlength="1" maxlength="40" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="username-rules username-note username-status">
<button type="submit" class="pbtn" id="username-save">Save username</button><button type="button" class="pbtn" id="username-cancel">Cancel</button></div>
<p id="username-rules" class="fine">1–40 letters, numbers, _ or -. Saved in lowercase.</p><p id="username-note" class="fine"></p></form>
<p id="username-status" role="status" aria-live="polite"></p>
<div class="accountnav" role="tablist" aria-label="Your collection"><button type="button" role="tab" id="tab-collection" aria-controls="panel-collection" aria-selected="true">▦ Collection</button><button type="button" role="tab" id="tab-team" aria-controls="panel-team" aria-selected="false" tabindex="-1">⚔ Team</button><button type="button" role="tab" id="tab-stats" aria-controls="panel-stats" aria-selected="false" tabindex="-1">◷ Stats</button></div>
<section id="panel-collection" role="tabpanel" aria-labelledby="tab-collection"><p id="inventory" class="fine"></p>
<form id="card-search" role="search"><div class="accountfilters cardbrowse"><label class="cardquery" for="q">Search cards<input id="q" type="search" maxlength="40" placeholder="Creature name" autocomplete="off"></label><button type="submit" class="pbtn">Search</button>
<label for="family">Family<select id="family"><option value="">All families</option><option value="haiku">✿ Haiku</option><option value="sonnet">≈ Sonnet</option><option value="opus">☀ Opus</option><option value="fable">☾ Fable</option></select></label>
<label for="rarity">Rarity<select id="rarity"><option value="">All rarities</option><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option></select></label>
<label for="sort">Sort<select id="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option><option value="rarity">Rarest first</option><option value="level">Highest level</option><option value="atk">Highest Attack</option><option value="def">Highest Defense</option><option value="spd">Highest Speed</option><option value="hp">Highest HP</option><option value="genes">Best genes</option></select></label></div>
<details class="morefilters" id="morefilters"><summary>More filters</summary><div class="accountfilters cardbrowse">
<label for="trait">Trait<select id="trait"><option value="">Any trait</option>${Object.entries(CARD_HELP.traits).map(([id,trait]) => html`<option value="${id}">${trait.name}</option>`)}</select></label>
<label for="finish">Finish<select id="finish"><option value="">Any finish</option><option value="foil">Foil</option><option value="shiny">Shiny</option><option value="both">Foil &amp; shiny</option></select></label>
<label for="scope">Show<select id="scope"><option value="">All cards</option><option value="team">On my team</option><option value="forTrade">Marked for trade</option><option value="available">Not held</option></select></label></div></details>
<button type="button" class="accountquiet" id="filters-reset">Reset filters</button></form>
<p id="collection-status" role="status" aria-live="polite"></p>
<div id="collection" class="accountcards" aria-busy="false"></div><button class="pbtn" id="more" hidden>Load more cards</button>
<p class="accountfootnote fine">Open packs and manage your team in Claude Code.</p></section>
<section id="panel-team" role="tabpanel" aria-labelledby="tab-team" hidden><div class="accountsectionhead"><h2>Your team</h2><p class="fine">Lead first. Friends step in when it faints.</p></div><div id="teamcards" class="accountcards"></div></section>
<section id="panel-stats" role="tabpanel" aria-labelledby="tab-stats" hidden><h2>Your journey</h2><div id="stats" class="accountstats"></div>
<div class="accountranking"><div class="accountsectionhead"><h2>Your rankings</h2><a id="publicboard" href="/boards">See leaderboard ↗</a></div><div class="accountfilters"><label>Board <select id="board"><option value="rating">Rating</option><option value="beaten">Players beaten</option><option value="duelWins">Duel wins</option><option value="species">Species collected</option><option value="mythics">Mythics found</option><option value="sales">Market sales</option></select></label>
<label>When <select id="period"><option value="all">All time</option><option value="season">This season</option></select></label></div>
<p id="rank" role="status" aria-live="polite"></p><p class="fine">Places update at midnight UTC.</p></div></section></div>
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
.account{background:var(--paper)}.accountpage{max-width:1100px;padding-top:32px;padding-bottom:64px;color:var(--pink)}
.accountpage [hidden]{display:none!important}.accounthead{margin-bottom:24px}.accounthead h1{margin:0;font-size:28px}.accounthead .pt{--gp:2px}
.accountpage h2{margin:0 0 16px;font-size:22px}.accountpage p{margin:12px 0}.accountpage .fine{font-size:13px;line-height:1.5;color:var(--psoft)}
.accountprofile{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;padding:24px;background:color-mix(in srgb,var(--paper) 94%,var(--pink));border:1px solid var(--pline);border-bottom:3px solid var(--pline)}
.accountidentity,.accountname,.accountactions{display:flex;align-items:center;gap:12px}.accountidentity{min-width:0}.accountidentity>div:last-child{min-width:0}.accountidentity #myhandle{margin:0;font-weight:800;font-size:22px;overflow-wrap:anywhere}.accountpage .accounteyebrow{font-size:12px;margin:0 0 4px;color:var(--psoft)}
#profile-art{width:56px;height:56px;flex:none;display:grid;place-items:center;background:var(--paper);border:2px solid var(--pline)}#profile-art img{width:48px;height:48px;image-rendering:pixelated}
.accountpage .accountedit,.accountpage .accountquiet{font:inherit;min-height:44px;color:var(--psoft);background:none;border:0;padding:8px;cursor:pointer}.accountpage .accountedit{font-size:22px;min-width:40px}.accountpage .accountquiet:hover,.accountpage .accountedit:hover{color:var(--pink);text-decoration:underline}
.accountbalance{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;border-top:1px solid var(--pline);padding-top:16px}.accountbalance .accountstat{padding:0;border:0;background:none}.accountbalance .accountstat b{font-size:21px}.accountbalance .accountstat span{font-size:12px}
.accountnav{display:flex;gap:8px;margin:24px 0 20px;border-bottom:1px solid var(--pline)}.accountnav button{font:inherit;font-weight:700;color:var(--psoft);background:none;border:0;border-bottom:3px solid transparent;padding:12px 16px;min-height:48px;cursor:pointer}.accountnav button[aria-selected=true]{color:var(--pink);border-bottom-color:var(--pink)}
.accountfilters{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.accountfilters label{display:flex;align-items:center;gap:8px;min-width:0}.accountpage select,.accountpage input{font:inherit;font-size:14px;color:var(--pink);background:var(--paper);border:1px solid var(--pline);border-radius:4px;min-height:44px;padding:8px 10px;max-width:100%;box-sizing:border-box}.accountpage input{min-width:0}.accountpage input[aria-invalid=true]{border-color:var(--pink)}
.accountpage .pbtn{font:inherit;font-size:14px;font-weight:700;min-height:44px;border:2px solid var(--psoft);border-radius:4px;padding:8px 14px;color:var(--paper);background:var(--pink)}.accountpage button:disabled{opacity:.5;cursor:default}
#username-form{margin-top:12px;border:1px solid var(--pline);padding:16px}#username-form>label{display:block;font-size:13px;font-weight:700;margin-bottom:8px}#username-form .accountfilters{gap:8px}#username{width:24ch}#username-form .fine{margin-bottom:0}
#card-search{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:12px;background:color-mix(in srgb,var(--paper) 96%,var(--pink));border:1px solid var(--pline);margin:12px 0}#card-search .accountquiet{min-height:32px;padding:4px 8px}.cardbrowse{align-items:end;width:100%;gap:12px}.cardbrowse label{flex:1 1 120px;display:flex;flex-direction:column;align-items:start;font-size:12px;gap:4px}.cardbrowse select,.cardbrowse input{width:100%}.cardbrowse .cardquery{flex:2 1 170px}.morefilters{flex:1;min-width:160px}.morefilters>summary{cursor:pointer;min-height:32px;align-content:center;font-size:13px;color:var(--psoft)}.morefilters[open]{flex-basis:100%}.morefilters .cardbrowse{margin:8px 0}
#collection-status{font-size:13px;color:var(--psoft);min-height:20px}.accountcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,224px),1fr));gap:20px;align-items:start}.accountcard{position:relative;min-width:0;background:var(--paper)}.accountcard .cf{width:100%;box-sizing:border-box;padding:6px 8px 8px}
.accountcard img{display:block;width:80px;height:80px;image-rendering:pixelated;margin:auto}.accountcard a{display:block;font-weight:700;overflow-wrap:anywhere;text-align:center}.accountcard .cf-name{overflow:visible;text-overflow:clip;white-space:normal;font-size:16px;margin:8px 0 2px}.accountcard .cf-art{padding:8px 0;box-sizing:border-box}.accountcard .cf-rar,.accountcard .cf-kind{font-size:12px;margin:2px 0}
.accountplaque{padding:8px 10px;border:1px solid var(--pline);border-top:0}.cardstats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;border-bottom:1px solid var(--pline);padding-bottom:8px}.cardstats .cardhint-label{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;text-align:center;text-decoration:none;font-size:11px}.cardstats b{font-size:19px;line-height:1.2}.cardstats .cardhint-label:hover span,.cardstats .cardhint-label:focus-visible span{text-decoration:underline dotted}
.cardtraits{display:flex;flex-wrap:wrap;gap:4px 8px;margin:4px 0}.cardhint-label{font:inherit;font-size:12px;font-weight:600;color:var(--pink);background:transparent;border:0;min-height:44px;padding:4px 0;text-decoration:underline dotted;text-underline-offset:4px;text-align:left;cursor:help;overflow-wrap:anywhere}.cardtraits .cardhint-label{min-height:28px;cursor:pointer}.carddetails{border-top:1px solid var(--pline);margin-top:4px}.accountcard summary{cursor:pointer;min-height:40px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--psoft)}.accountcard summary::before{content:'＋'}.accountcard details[open]>summary::before{content:'−'}.carddetails .cardhint{display:inline-block;margin-right:12px}.carddetails p{font-size:12px;overflow-wrap:anywhere}
.accountcard .cardhint-tip{position:absolute;left:0;right:0;z-index:5;margin:0;padding:12px;background:var(--pink);color:var(--paper);border:2px solid var(--psoft);font-size:14px;line-height:1.5;overflow-wrap:anywhere;box-shadow:0 4px 0 #0002}
.accountstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border:1px solid var(--pline)}.accountstat{padding:20px;border:1px solid var(--pline);background:color-mix(in srgb,var(--paper) 97%,var(--pink))}.accountstat b{display:block;font-size:28px}.accountstat span{font-size:13px;color:var(--psoft)}.accountsectionhead{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:8px 0 20px}.accountsectionhead h2,.accountsectionhead p{margin:0}.accountranking{margin-top:32px;padding:24px;border:1px solid var(--pline)}.accountranking a{font-size:13px}.accountranking #rank{font-size:24px;font-weight:800;margin:20px 0 8px}
.accountfootnote{margin-top:24px!important}#more{display:block;margin:24px auto}#signedout{max-width:640px;margin:40px auto;text-align:center;padding:40px 24px;border:2px solid var(--pline);box-shadow:6px 6px 0 var(--pline)}.accountwelcome{display:block;font-size:48px;color:var(--psoft);margin-bottom:16px}#signedout .lede{font-size:16px;margin:16px 0 24px}.accountsigninhelp{margin-top:20px}.accountsigninhelp summary{font-size:13px;color:var(--psoft);cursor:pointer}
#account-status:empty,#username-status:empty{display:none}.accountpage button:focus-visible,.accountpage input:focus-visible,.accountpage select:focus-visible,.accountpage summary:focus-visible{outline:3px solid var(--pink);outline-offset:3px}
@media(min-width:900px){.accountprofile{grid-template-columns:minmax(0,1fr) minmax(340px,1fr) auto;align-items:center;padding:16px 20px;gap:16px}.accountidentity{grid-column:1;grid-row:1}.accountbalance{grid-column:2;grid-row:1;border:0;padding:0;gap:8px}.accountactions{grid-column:3;grid-row:1;flex-direction:row;gap:4px;align-items:center}.accountidentity #myhandle{font-size:20px}.accounthead{margin-bottom:16px}.accountnav{margin-top:20px}}
@media(max-width:600px){.accountprofile{padding:16px;gap:12px}.accountactions{gap:0;flex-direction:column;align-items:end}.accountidentity #myhandle{font-size:18px}.accountbalance{gap:8px}.accountbalance .accountstat b{font-size:18px}.accountnav{gap:0}.accountnav button{padding:12px 10px;font-size:13px;flex:1}.accountstats{grid-template-columns:repeat(2,minmax(0,1fr))}.accountstat{padding:16px}.accountranking{padding:16px}.accountcards{gap:16px}}
@media(max-width:400px){.accountpage{padding-top:24px}.accounthead h1{font-size:22px}.accountprofile{grid-template-columns:minmax(0,1fr);padding:12px;gap:8px}.accountpage .accounteyebrow{display:none}#profile-art{width:48px;height:48px}#profile-art img{width:40px;height:40px}.accountactions{grid-row:2;flex-direction:row;justify-content:end}.accountbalance{grid-row:3;grid-template-columns:repeat(2,minmax(0,1fr));padding-top:12px}.accountbalance .accountstat b{line-height:1.25}.accountbalance .accountstat span{line-height:1.2}.accountnav button{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:10px 6px;font-size:12px;min-height:44px}.accountnav #tab-collection{flex:2}.cardbrowse label{flex-basis:calc(50% - 6px)}.cardbrowse .cardquery{flex-basis:calc(100% - 86px)}.cardbrowse .cardquery+button{padding:8px 10px}.accountcards{grid-template-columns:minmax(0,1fr)}#signedout{padding:24px 16px}.accountpage .accountquiet{font-size:13px}}
`
