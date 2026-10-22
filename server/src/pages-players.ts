// The public trainer directory exposes existing profile handles and saved-team lead art only.
// Its search is a native GET form; no sign-in, activity ordering or new mod endpoint is involved.
import { HANDLE_RE, S, SchemaError } from '../../plugin/hooks/core/schemas.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { BattleCard } from '../../plugin/hooks/core/types.ts'
import type { Api } from './app.ts'
import type { Db } from './db.ts'
import { cardsByIds, publicCard } from './game/mint.ts'
import { b64urlDecode, b64urlEncode } from './game/passkeys.ts'
import { fail } from './http.ts'
import { heading, html, layout, PLACE, PLACE_CSS, raw, SITE_CSP, text } from './pages-html.ts'
import { placeStripSvg } from './pages-scene.ts'
import { spriteSvg } from './pages-sprite.ts'

export const PLAYERS_PAGE = 24
export const PLAYERS_CSP = SITE_CSP.replace("form-action 'none'", "form-action 'self'")
type Query = { q?: string; after?: string }
type Trainer = { handle: string; lead?: BattleCard }
const schema = S.obj<Query>({
  q: S.optional(S.str({ max: 40, re: /^[\x20-\x7e]*$/ })),
  after: S.optional(S.str({ min: 1, max: 180, re: /^[A-Za-z0-9_-]+$/ })),
})
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true })
const bad = (): never => fail('bad_request', 'Malformed player search')

function queryOf(params: URLSearchParams): Query {
  const values: Record<string, string> = Object.create(null)
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) bad()
    values[key] = value
  }
  try {
    const q = schema(values, '$')
    return { ...(q.q?.trim() ? { q: q.q.trim().toLowerCase() } : {}), ...(q.after ? { after: q.after } : {}) }
  } catch (err) {
    if (err instanceof SchemaError) bad()
    throw err
  }
}

function afterHandle(q: Query): string | null {
  if (!q.after) return null
  try {
    const decoded: unknown = JSON.parse(decode.decode(b64urlDecode(q.after)))
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== 1 || decoded[1] !== (q.q ?? '') || typeof decoded[2] !== 'string' || !HANDLE_RE.test(decoded[2])) return bad()
    return decoded[2]
  } catch { return bad() }
}

/** One bounded page, joined to ownership before any card is hydrated; no hidden-board stats read. */
async function players(db: Db, q: Query): Promise<{ trainers: Trainer[]; next?: string }> {
  const after = afterHandle(q)
  const rows = await db.all<{ handle: string; lead: string | null }>(
    `SELECT p.handle, c.id AS lead FROM players p
     LEFT JOIN cards c ON c.id = json_extract(p.team, '$[0]') AND c.owner_id = p.id
     WHERE instr(lower(p.handle), ?) > 0 ${after ? 'AND (lower(p.handle) > ? OR (lower(p.handle) = ? AND p.handle > ?))' : ''}
     ORDER BY lower(p.handle), p.handle LIMIT ?`, q.q ?? '', ...(after ? [after.toLowerCase(), after.toLowerCase(), after] : []), PLAYERS_PAGE + 1,
  )
  const page = rows.slice(0, PLAYERS_PAGE), cards = await cardsByIds(db, page.flatMap(row => row.lead ? [row.lead] : []))
  const trainers = page.map(row => {
    const c = row.lead ? cards.get(row.lead)?.card : undefined
    return { handle: row.handle, ...(c ? { lead: publicCard(c) } : {}) }
  })
  const last = page.at(-1)
  return { trainers, ...(rows.length > PLAYERS_PAGE && last ? { next: b64urlEncode(encode.encode(JSON.stringify([1, q.q ?? '', last.handle]))) } : {}) }
}

function href(q: Query, after?: string): string {
  const params = new URLSearchParams()
  if (q.q) params.set('q', q.q)
  if (after) params.set('after', after)
  return `/players${params.size ? '?' + params : ''}`
}

export function registerPlayers(api: Api): void {
  api.add({
    method: 'GET', path: '/players', public: true, limit: 'browse',
    handler: async ctx => {
      const q = queryOf(ctx.url.searchParams), found = await players(ctx.db, q)
      const [sky, ground, shade] = PLACE.haiku
      const response = layout({
        kind: 'site', title: 'Players: Spinlings', description: 'Find Spinlings trainers and visit their public profiles, teams and collections.',
        path: '/players', origin: ctx.origin, noindex: true, cache: 'no-store', now: ctx.now, css: PLAYERS_CSS,
        body: html`<div class="place" style="--psky:${sky};--pground:${ground};--pshade:${shade}" aria-hidden="true">${raw(placeStripSvg())}</div>
<section class="wrap players">
<div class="players-head"><div><h1>${heading('Players')}</h1><p class="lede">Find a trainer. Meet their team and browse their collection.</p></div><a class="pbtn" href="/account"><span class="face">Your profile</span></a></div>
<form class="players-search" method="get" action="/players" role="search"><label for="player-search">Search usernames</label><div><input id="player-search" name="q" type="search" maxlength="40" autocomplete="off" value="${q.q ?? ''}" placeholder="Trainer username"><button class="pbtn" type="submit"><span class="face">Search</span></button>${q.q ? html`<a class="players-clear" href="/players">Clear</a>` : ''}</div></form>
${found.trainers.length ? html`<ul class="trainers">${found.trainers.map(p => html`<li><a class="trainer" href="/u/${encodeURIComponent(p.handle)}" aria-label="${`Visit ${text(p.handle, 40)}’s profile`}"><span class="trainer-art">${p.lead ? raw(spriteSvg(spriteFor(p.lead), { flash: false })) : html`<span class="trainer-empty" aria-hidden="true">✦</span>`}</span><span class="trainer-name">${text(p.handle, 40)}</span><span class="trainer-arrow" aria-hidden="true">→</span></a></li>`)}</ul>` : html`<p class="players-empty">${q.q ? 'No trainers match that username. Try a shorter name.' : 'No trainers here yet. Your camp could be the first.'}</p>`}
<nav class="players-pages" aria-label="Player pages">${q.after ? html`<a href="${href(q)}">Back to first page</a>` : ''}${found.next ? html`<a class="next" href="${href(q, found.next)}">More players →</a>` : ''}</nav>
<p class="players-boards"><a href="/boards">See the leaderboards</a></p>
</section>`,
      })
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', PLAYERS_CSP)
      return new Response(response.body, { status: response.status, headers })
    },
  })
}

export const PLAYERS_CSS = PLACE_CSS + `
main{display:block;background:#1c1a26;color:#f4f2fb;padding-bottom:var(--s6)}main :focus-visible{outline-color:#fffdf5}
.place{margin-bottom:var(--s4)}.place .placeart{left:50%;transform:translateX(-50%);width:calc(480 * var(--ap));height:calc(64 * var(--ap))}
.players{overflow-wrap:anywhere}.players-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s3)}
.players-head h1{font-size:clamp(2rem,1.4rem + 2.4vw,3rem);font-weight:800;line-height:1.2}.players .lede{margin-top:var(--s3);font-size:1.125rem;color:#e2deee}
.players-search{margin-top:var(--s4)}.players-search label{display:block;font-weight:700;margin-bottom:var(--s2)}.players-search>div{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s3)}
.players-search input{min-width:0;flex:1 1 220px;max-width:480px;border:2px solid #70617d;padding:11px 14px;background:#26222f;color:#f4f2fb;font:inherit;border-radius:0}.players-search input::placeholder{color:#bfb5cc}.players-clear{display:inline-flex;align-items:center;min-height:44px}
.trainers{list-style:none;margin:var(--s4) 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:var(--s3)}
.trainers li{min-width:0}.trainer{display:grid;grid-template-columns:72px minmax(0,1fr) 20px;align-items:center;gap:var(--s3);min-height:104px;padding:var(--s3);color:inherit;text-decoration:none;background:#292232;box-shadow:inset 0 -4px 0 #110e18}.trainer:hover{background:#352b40}
.trainer-art{width:72px;height:72px;display:grid;place-items:center;background:#1c1a26}.trainer-art .spr{width:64px;height:64px}.trainer-name{font-weight:750;overflow-wrap:anywhere}.trainer-arrow{color:#ffe2a0}.trainer-empty{font-size:2rem;color:#8b789b}
.players-empty{margin-top:var(--s4);padding:var(--s4);background:#292232;color:#c9c3d6}.players-pages{display:flex;flex-wrap:wrap;gap:var(--s3);margin-top:var(--s4)}.players-pages a,.players-boards a{display:inline-flex;align-items:center;min-height:44px}.players-pages .next{margin-left:auto}.players-boards{margin-top:var(--s3)}
@media(max-width:479px){.trainer{grid-template-columns:56px minmax(0,1fr) 16px;gap:var(--s2);padding:var(--s3) var(--s2)}.trainer-art{width:56px;height:64px}.trainer-art .spr{width:48px;height:48px}.players-search input{flex-basis:100%;max-width:none}.players-empty{padding:var(--s3)}}
`
