// The site's HTML layer: a template tag that escapes every interpolated value unless it is already
// markup, the one page layout (head, header, footer, stylesheet) and the pieces pages share. Pages
// carry no script except the two passkey pages (SPEC 12, 30), load nothing from other origins, and
// read well in light and dark down to 360 px.
import { cardName, geneScore } from '../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { cleanText } from '../../plugin/hooks/core/schemas.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import type { BattleCard } from '../../plugin/hooks/core/types.ts'
import { FAMILY_COLOR, FAMILY_MARK, MARK, MYTHIC_COLOR, RARITY_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import { escapeHtml } from './http.ts'
import { cardSvg, pixelTextSvg } from './pages-art.ts'

// ---- escaping by construction ------------------------------------------------------------------

/** Markup that is already safe. Only the `html` tag and the art builders make it. */
export type Raw = { readonly __html: string }
export type Value = string | number | Raw | null | undefined | false | readonly Value[]

export const raw = (markup: string): Raw => ({ __html: markup })

const render = (v: Value): string =>
  v === null || v === undefined || v === false ? ''
    : Array.isArray(v) ? v.map(render).join('')
    : typeof v === 'object' ? (v as Raw).__html
    : escapeHtml(String(v))

/** Markup with every interpolated string or number HTML-escaped; Raw values and arrays of them pass through. */
export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0]!
  values.forEach((v, i) => { out += render(v) + strings[i + 1]! })
  return raw(out)
}

/** Text from the database (names, handles, stamps): control characters out, length bounded. */
export const text = (s: unknown, max = 60) => cleanText(s, max)

// ---- constants ---------------------------------------------------------------------------------

export const REPO = 'https://github.com/416rehman/spinlings'
/** SPEC 34: the one line, typed inside Claude Code. */
export const INSTALL = '/plugin install spinlings --marketplace 416rehman/spinlings'
export const ASK = 'install the Spinlings mod from 416rehman/spinlings'

export const PAGE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
/** The passkey pages: one first-party script, and its posts back to this origin. */
export const SCRIPT_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// ---- the stylesheet ----------------------------------------------------------------------------

const fam = Object.entries(FAMILY_COLOR).map(([f, c]) => `--${f}:${c}`).join(';')
const rar = Object.entries(RARITY_COLOR).map(([r, c]) => `--${r}:${c}`).join(';')

export const GRASS = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 6" shape-rendering="crispEdges"><path fill="#6fae5c" d="M0 1h3v1h2v-1h4v1h3v-1h4v5h-16z"/><path fill="#9ed36a" d="M0 1h3v1h-3zM5 1h4v1h-4zM12 1h4v1h-4zM3 2h2v1h-2zM9 2h3v1h-3z"/><path fill="#4f8f45" d="M2 4h1v1h-1zM9 3h1v1h-1zM13 4h1v1h-1z"/></svg>`,
).replace(/'/g, '%27')

export const CSS = `
:root{color-scheme:light dark;${fam};${rar};--mythic:${MYTHIC_COLOR};--gold:${RARITY_COLOR.legendary};
--bg:#eef1ea;--sky:#dde8e3;--surface:#f9faf6;--chip:#e4e9e0;--ink:#1f1d2b;--soft:#4f4d63;--faint:#75738a;--line:#d2d9cd;
--shade:#2b2937;--hide:25%;--focus:#3d6fd6;--grass:#6fae5c;--hill:#c8dccd;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--round:ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,Comfortaa,Manjari,"Arial Rounded MT Bold","Arial Rounded MT",Calibri,var(--sans);
--mono:ui-monospace,"SF Mono","Cascadia Mono","Segoe UI Mono",Menlo,Consolas,monospace;
--s1:4px;--s2:8px;--s3:16px;--s4:32px;--s5:64px;--s6:128px;--px:4px}
@media (prefers-color-scheme:dark){:root{--bg:#11151e;--sky:#172131;--surface:#19202c;--chip:#222b3a;--ink:#edebf4;--soft:#b0aec2;--faint:#8b8a9e;
--line:#283143;--shade:#0a0d14;--hide:42%;--focus:#8fb1ff;--grass:#2f6a40;--hill:#1f2e44}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:400 1.0625rem/1.6 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden}
svg{display:block}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:.22em}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:6px}
h1,h2,h3{font-family:var(--round);line-height:1.15;margin:0;letter-spacing:-.01em;text-wrap:balance}
h1{font-size:clamp(2rem,1.25rem + 3.4vw,3.375rem);font-weight:800}
h2{font-size:clamp(1.5rem,1.2rem + 1.2vw,2rem);font-weight:800}
h3{font-size:1.1875rem;font-weight:700}
p{margin:0;max-width:62ch}
code,pre{font-family:var(--mono);font-size:.9375rem}
.wrap{width:100%;max-width:1120px;margin-left:auto;margin-right:auto;padding-left:16px;padding-right:16px}
@media (min-width:768px){.wrap{padding-left:32px;padding-right:32px}}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.mark{font-variant-emoji:text}
.soft{color:var(--soft)}
.ptext{color:currentColor}

.top{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);padding-top:var(--s3);padding-bottom:var(--s3)}
.brand{display:flex;align-items:center;gap:var(--s2);text-decoration:none;color:var(--ink)}
.brand .ptext{width:auto;height:27px}
.top nav{display:flex;gap:var(--s3);font-size:.9375rem}
.top nav a{text-decoration:none;color:var(--soft);padding:var(--s2) 0}
.top nav a:hover{color:var(--ink);text-decoration:underline}
@media (max-width:600px){.top nav .wide{display:none}}

main{display:block}
section{padding-top:var(--s5)}
.lede{font-size:1.1875rem;color:var(--soft);margin-top:var(--s3)}
.head{margin-bottom:var(--s3)}
.head h2{display:inline}
.head .chip{margin-left:12px;vertical-align:6px}
.head p{margin-top:var(--s2);color:var(--soft)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 4px;border-radius:999px;background:var(--chip);font-size:.875rem;color:var(--soft);white-space:nowrap}

.install{margin-top:var(--s4);max-width:560px}
.install .label{font-size:.9375rem;font-weight:600;margin-bottom:var(--s2)}
.cmd{margin:0;padding:14px var(--s3) 15px;border-radius:12px;background:#1f1d2b;color:#f4f2fb;border:1px solid #33304a;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
.cmd code{user-select:all;-webkit-user-select:all;cursor:text}
.cmd .w{white-space:nowrap}
.cmd code::selection{background:#4f8ff0;color:#fff}
@media (prefers-color-scheme:dark){.cmd{background:#0b0e14;border-color:#2a3242}}
.install .alt{margin-top:var(--s2);font-size:.9375rem;color:var(--soft)}
.install .alt q{color:var(--ink)}

.card{position:relative;display:flex;flex-direction:column;align-items:center;gap:var(--s2);padding:var(--s3) var(--s2) 14px;
border:2px solid var(--rar,var(--line));border-radius:14px;background:var(--surface);text-align:center;min-width:0}
.card.foil{border-color:transparent;background:linear-gradient(var(--surface),var(--surface)) padding-box,
linear-gradient(135deg,#ff7ac6,#f2b33d,#9ed36a,#5b8def,#a874e8,#ff7ac6) border-box}
.card .art{display:grid;place-items:center;width:100%;padding:var(--s2) 0 0;border-bottom:4px solid var(--fam)}
.card .art svg{width:calc(16 * var(--px));height:calc(16 * var(--px))}
.card .name{font-family:var(--round);font-weight:700;font-size:1.0625rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .meta{display:flex;flex-wrap:wrap;justify-content:center;gap:2px 10px;font-size:.8125rem;color:var(--soft)}
.card .rar{color:var(--ink);font-weight:600}
.card .rar::before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:2px;background:var(--rar);vertical-align:1px}
.cards{--px:5px;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:var(--s3)}

.foot{margin-top:var(--s6);padding-top:var(--s4);padding-bottom:var(--s5);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:var(--s3) var(--s4);
justify-content:space-between;font-size:.9375rem;color:var(--soft)}
.foot nav{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s3)}
.foot a{color:var(--soft)}
.foot a:hover{color:var(--ink)}

.notice{padding-top:var(--s5)}
.notice>*{max-width:640px}
.notice h1{font-size:clamp(1.75rem,1.4rem + 1.6vw,2.5rem)}
.notice p{margin-top:var(--s3);color:var(--soft)}
.prose>*{max-width:720px}
.prose h2{margin-top:var(--s5);margin-bottom:var(--s3)}
.prose h3{margin-top:var(--s4);margin-bottom:var(--s2)}
.prose p+p{margin-top:var(--s3)}
.prose ul{padding-left:1.25em;margin:var(--s3) 0 0}
.prose li+li{margin-top:var(--s2)}
.table{width:100%;max-width:720px;border-collapse:collapse;margin-top:var(--s3);font-size:.9375rem}
.table th,.table td{text-align:left;padding:10px var(--s2) 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
.table th{font-weight:600}
.table th.n{text-align:right;padding-right:0}
.table td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-right:0}
.tablewrap{overflow-x:auto}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`

// ---- the page ----------------------------------------------------------------------------------

export type PageOptions = {
  title: string
  description: string
  /** this page's path, for og:url */
  path: string
  origin: string
  body: Raw
  /** extra CSS for this page */
  css?: string
  og?: { title: string; description: string; image?: string; imageAlt?: string }
  /** keep it out of search engines (anything about one player, card or link) */
  noindex?: boolean
  /** the passkey pages: load /static/passkey.js under SCRIPT_CSP */
  script?: boolean
  status?: number
  cache?: string
}

const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#2f8f63" d="M1 1h2v1h2v-1h2v6h-6z"/><path fill="#5fbf8f" d="M2 2h4v4h-4z"/><path fill="#1d1726" d="M2 3h1v2h-1zM5 3h1v2h-1z"/></svg>',
)

export function layout(o: PageOptions): Response {
  const url = o.origin + o.path
  const og = o.og
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<meta name="description" content="${o.description}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef1ea" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#11151e" media="(prefers-color-scheme: dark)">
${o.noindex ? html`<meta name="robots" content="noindex">` : ''}
<link rel="icon" href="${FAVICON}">
${og ? html`<meta property="og:site_name" content="Spinlings">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${og.title}">
<meta property="og:description" content="${og.description}">
${og.image ? html`<meta property="og:image" content="${og.image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${og.imageAlt ?? og.title}">
<meta name="twitter:card" content="summary_large_image">` : html`<meta name="twitter:card" content="summary">`}` : ''}
<style>${raw(CSS + (o.css ?? ''))}</style>
${o.script ? html`<script src="/static/passkey.js" defer></script>` : ''}
</head>
<body>
${header()}
<main id="main">
${o.body}
</main>
${footer()}
</body>
</html>
`
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': o.cache ?? 'no-store',
    'Content-Security-Policy': o.script ? SCRIPT_CSP : PAGE_CSP,
  }
  if (o.script) headers['Cross-Origin-Opener-Policy'] = 'same-origin'
  return new Response(doc.__html, { status: o.status ?? 200, headers })
}

function header(): Raw {
  return html`<header class="top wrap">
<a class="brand" href="/">${raw(pixelTextSvg('spinlings', { scale: 3, label: 'Spinlings' }))}</a>
<nav aria-label="Site"><a class="wide" href="/#how">How it plays</a><a class="wide" href="/#season">This season</a><a href="/privacy">Privacy</a><a href="${REPO}">Source</a></nav>
</header>`
}

function footer(): Raw {
  return html`<footer class="foot wrap">
<p>Open source, MIT. A creature card game for Claude Code. No money, no ads, no tracking.</p>
<nav aria-label="More"><a href="/odds">Odds</a><a href="/privacy">Privacy</a><a href="${REPO}">Source code</a><a href="${REPO}/blob/main/SECURITY.md">Report a problem</a><a href="${REPO}/blob/main/docs/self-hosting.md">Run your own server</a></nav>
</footer>`
}

/**
 * A command to type, as one selectable line: one click selects it all, and it wraps only between
 * words, so `--marketplace` never splits. The copied text is exactly the command.
 */
export const command = (line: string): Raw => html`<code>${line.split(' ').map((w, i) => html`${i ? ' ' : ''}<span class="w">${w}</span>`)}</code>`

/** The one-line install (SPEC 34), selectable with one click. */
export function installBlock(id = 'install', label = 'Type this inside Claude Code'): Raw {
  return html`<div class="install">
<p class="label" id="${id}-label">${label}</p>
<pre class="cmd" aria-labelledby="${id}-label">${command(INSTALL)}</pre>
<p class="alt">Or just ask Claude: <q>${ASK}</q></p>
</div>`
}

/** A notice page: expired links, unknown handles, ended drops. */
export function notice(o: Omit<PageOptions, 'body' | 'description'> & { heading: string; lines: Value[]; extra?: Raw }): Response {
  return layout({
    ...o,
    description: o.heading,
    noindex: true,
    body: html`<section class="notice wrap"><h1>${o.heading}</h1>${o.lines.map(l => html`<p>${l}</p>`)}${o.extra ?? ''}</section>`,
  })
}

// ---- cards -------------------------------------------------------------------------------------

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export const isMythic = (c: BattleCard) => c.species === 'mythic'
export const rarityWord = (c: BattleCard) => (isMythic(c) ? 'Mythic' : cap(c.rarity))
export const rarityColor = (c: BattleCard) => (isMythic(c) ? MYTHIC_COLOR : RARITY_COLOR[c.rarity])
export const finalForm = (c: BattleCard) => c.stage === 3 && (isMythic(c) || c.rarity === 'legendary' || c.form?.legendary === true)

export const familyStyle = (c: Pick<BattleCard, 'family'>) => `--fam:${FAMILY_COLOR[c.family]}`

/** What else a card is, in words (never colour alone, SPEC 21.9); finishes are words with no glyph. */
export function stamps(c: BattleCard): string[] {
  const out: string[] = []
  if (c.shiny) out.push('Shiny')
  if (c.foil) out.push('Foil')
  if (c.firstFind) out.push(`${MARK.first} First discovered`)
  if (isMythic(c)) out.push(`${MARK.mythic} Mythic, 1 of 1`)
  if (c.form?.kind === 'mythic' && c.form.discoveredBy) out.push(`Discovered by ${text(c.form.discoveredBy, 40)}`)
  if (c.form?.kind === 'promo' && c.form.stamp) out.push(text(c.form.stamp, 40))
  return out
}

/** The tile: art, name, rarity word, family and level (SPEC 21's one card component). */
export function cardTile(c: BattleCard, o: { link?: boolean } = {}): Raw {
  const name = text(cardName(c), 40)
  const art = raw(cardSvg(c, { scale: 4 }))
  const inner = html`<div class="art">${art}</div>
<span class="name">${name}</span>
<span class="meta"><span class="rar">${rarityWord(c)}</span><span><span class="mark" aria-hidden="true">${FAMILY_MARK[c.family]}</span> ${FAMILY_INFO[c.family].name}</span><span>Level ${c.level}</span></span>
${stamps(c).length ? html`<span class="meta">${stamps(c).map(s => html`<span>${s}</span>`)}</span>` : ''}`
  return html`<li class="card${c.foil ? ' foil' : ''}" style="${familyStyle(c)};--rar:${rarityColor(c)}">${o.link ? html`<a class="cardlink" href="/c/${c.id}" aria-label="${name}, ${rarityWord(c)}">${inner}</a>` : inner}</li>`
}

export const cardTiles = (cards: readonly BattleCard[], o: { link?: boolean } = {}): Raw =>
  html`<ul class="cards">${cards.map(c => cardTile(c, o))}</ul>`

/** The full card: big art, every public fact about it, traits with what they do. */
export function fullCard(c: BattleCard): Raw {
  const name = text(cardName(c), 48)
  const st = c.stats
  return html`<article class="full${c.foil ? ' foil' : ''}" style="${familyStyle(c)};--rar:${rarityColor(c)}">
<div class="bigart">${raw(cardSvg(c, { scale: 12, label: name }))}</div>
<div class="facts">
<h1>${name}</h1>
<p class="kind"><span class="rarword">${rarityWord(c)}</span> <span class="mark" aria-hidden="true">${FAMILY_MARK[c.family]}</span> ${FAMILY_INFO[c.family].name} family</p>
<p class="lv">Level ${c.level}. ${finalForm(c) ? 'Final form.' : `Stage ${c.stage} of 3.`} Genes ${geneScore(c.genes)}%.</p>
${stamps(c).length ? html`<ul class="stamps">${stamps(c).map(s => html`<li>${s}</li>`)}</ul>` : ''}
<dl class="stats"><div><dt>HP</dt><dd>${st.hp}</dd></div><div><dt>Attack</dt><dd>${st.atk}</dd></div><div><dt>Defense</dt><dd>${st.def}</dd></div><div><dt>Speed</dt><dd>${st.spd}</dd></div></dl>
${c.traits.length ? html`<ul class="traits">${c.traits.map(t => html`<li><strong>${TRAITS[t]?.name ?? t}</strong> <span>${TRAITS[t]?.text ?? ''}</span></li>`)}</ul>` : ''}
</div>
</article>`
}

export const FULL_CSS = `
.full{display:grid;gap:var(--s4);align-items:center;padding:var(--s4) var(--s3);border:2px solid var(--rar);border-radius:20px;background:var(--surface)}
.full.foil{border-color:transparent;background:linear-gradient(var(--surface),var(--surface)) padding-box,linear-gradient(135deg,#ff7ac6,#f2b33d,#9ed36a,#5b8def,#a874e8,#ff7ac6) border-box}
.bigart{display:grid;place-items:center;padding:var(--s3) 0 0;border-bottom:6px solid var(--fam)}
.bigart svg{width:min(192px,60vw);height:auto}
.full h1{font-size:clamp(2rem,1.5rem + 2vw,2.75rem)}
.full .kind{margin-top:var(--s2);font-weight:600}
.full .rarword{color:var(--ink);padding:2px 10px 3px;border-radius:999px;border:2px solid var(--rar)}
.full .lv{margin-top:var(--s3);color:var(--soft)}
.stamps{list-style:none;padding:0;margin:var(--s3) 0 0;display:flex;flex-wrap:wrap;gap:var(--s2)}
.stamps li{padding:3px 10px 4px;border-radius:999px;background:var(--chip);font-size:.875rem}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2);margin:var(--s4) 0 0}
.stats div{padding:10px var(--s2) 12px;border-radius:10px;background:var(--chip);text-align:center}
.stats dt{font-size:.8125rem;color:var(--soft)}
.stats dd{margin:0;font:800 1.375rem/1.2 var(--round);font-variant-numeric:tabular-nums}
.traits{list-style:none;padding:0;margin:var(--s4) 0 0}
.traits li+li{margin-top:var(--s2)}
.traits span{color:var(--soft)}
@media (min-width:760px){.full{grid-template-columns:minmax(240px,320px) 1fr;padding:var(--s4)}.bigart svg{width:192px}}
`
