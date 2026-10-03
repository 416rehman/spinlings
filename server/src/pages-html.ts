// The site's HTML layer: a template tag that escapes every interpolated value unless it is already
// markup, the one page layout (head, header, footer, tokens) and the pieces pages share. Site pages
// load two first-party scripts (/static/sky.*.js and /static/site.*.js, SPEC 36) under SITE_CSP;
// /odds, /privacy and the "not here" page run no script; the passkey pages run passkey.js only.
// Nothing loads from another origin.
import { cardName, geneScore } from '../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { cleanText } from '../../plugin/hooks/core/schemas.ts'
import { EYE, miniSprite, SHINE, spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import type { BattleCard, Family } from '../../plugin/hooks/core/types.ts'
import { seasonOf, seasonStart } from '../../plugin/hooks/core/world.ts'
import { FAMILY_COLOR, FAMILY_MARK, MARK, MYTHIC_COLOR, RARITY_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import { escapeHtml } from './http.ts'
import { boldDefs, boldWords, glyphPath, layoutWord, pixelable, wordSvg } from './pages-font.ts'
import { regularCard } from './pages-meet.ts'
import { footTopSvg } from './pages-scene.ts'
import { spriteSvg } from './pages-sprite.ts'
import { regulars } from './pages-world.ts'
import { SITE_ASSETS } from '../static/site.gen.ts'

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

/** A heading in the pixel font's bold cut with its real words beside it for readers. */
export const pixelHeading = (words: string): Raw => html`${raw(boldWords(words))}<span class="sr">${words}</span>`

// ---- constants ---------------------------------------------------------------------------------

export const REPO = 'https://github.com/416rehman/spinlings'
/** SPEC 34: the one line, typed inside Claude Code. */
export const INSTALL = '/plugin install spinlings --marketplace 416rehman/spinlings'
export const ASK = 'install the Spinlings mod from 416rehman/spinlings'

/** /odds, /privacy and the "not here" page: no script at all. */
export const PAGE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
/** The passkey pages: one first-party script, and its posts back to this origin. */
export const SCRIPT_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
/** Site pages (SPEC 36): first-party scripts only, and they talk to nobody. */
export const SITE_CSP = "default-src 'none'; script-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// ---- tokens --------------------------------------------------------------------------------------

type Pal = { sky: [string, string, string, string]; peaks: string; hill: string; path: string; grass: [string, string, string]; light: string; rim: string; lamp: string; ink: string; soft: string; clear: string }

/** The six hour palettes (site brief 2.2): flat bands only. */
export const HOUR_PAL: Record<'morning' | 'afternoon' | 'dusk' | 'night' | 'morning-dark' | 'afternoon-dark', Pal> = {
  morning: { sky: ['#bfe3d3', '#cfeadb', '#def1e3', '#eef7ea'], peaks: '#9fcbb6', hill: '#74b48f', path: '#d9c9a3', grass: ['#a6d77a', '#67ad5c', '#3e7c4b'], light: '#fff4cf', rim: '#ffe39a', lamp: '#f4ecd0', ink: '#1d1726', soft: '#3d4a45', clear: '#2f5f3d' },
  afternoon: { sky: ['#f5b183', '#f8c39b', '#fbd5b4', '#fde6cd'], peaks: '#e19c78', hill: '#9fb15a', path: '#e8cf9c', grass: ['#c3d867', '#87ad4a', '#567f3a'], light: '#fff6d8', rim: '#ffd98a', lamp: '#f7ead0', ink: '#1d1726', soft: '#4a3428', clear: '#3f5f2b' },
  dusk: { sky: ['#2a3560', '#3f4675', '#6e5f8c', '#e3946a'], peaks: '#3a3a62', hill: '#2e3f52', path: '#7a6a6a', grass: ['#6f9a72', '#46705a', '#2c4c42'], light: '#ffcf8a', rim: '#ffe2a0', lamp: '#ffe2a0', ink: '#fdf6ec', soft: '#d6cfe0', clear: '#22403a' },
  night: { sky: ['#0d1630', '#142039', '#1a2a4a', '#22365c'], peaks: '#1c2846', hill: '#17243b', path: '#3a4258', grass: ['#3f6e5a', '#29503f', '#1a362d'], light: '#f3efd9', rim: '#fffbe6', lamp: '#ffe2a0', ink: '#eef1fb', soft: '#b7c0d8', clear: '#142a24' },
  'morning-dark': { sky: ['#22403f', '#2a4c48', '#335851', '#3d6459'], peaks: '#2f5048', hill: '#2c5a43', path: '#5d5a48', grass: ['#5f9a5e', '#3f7349', '#2a5238'], light: '#e9f2c8', rim: '#e9f2c8', lamp: '#e9f2c8', ink: '#eef4ec', soft: '#c3d3c6', clear: '#1d3a2a' },
  'afternoon-dark': { sky: ['#4a2f33', '#5a3a38', '#6b463d', '#7d5443'], peaks: '#5c3b33', hill: '#4f5a30', path: '#6b5a44', grass: ['#8fa553', '#5f7a3a', '#3f5a2c'], light: '#ffd9a0', rim: '#ffd9a0', lamp: '#ffd9a0', ink: '#fbefe4', soft: '#e0c9b8', clear: '#2c3a1f' },
}

/** Family places (sky, ground, shade): the battle band and every family page. */
export const PLACE: Record<Family, [string, string, string]> = {
  haiku: ['#dcefe2', '#5fbf8f', '#1f5a45'],
  sonnet: ['#dbe6fa', '#5b8def', '#1d3570'],
  opus: ['#f8e0d3', '#e8744f', '#6a2a17'],
  fable: ['#e7defa', '#a874e8', '#3a2262'],
}

const palVars = (p: Pal) => `--sky1:${p.sky[0]};--sky2:${p.sky[1]};--sky3:${p.sky[2]};--sky4:${p.sky[3]};--peaks:${p.peaks};--hill:${p.hill};--path:${p.path};`
  + `--g1:${p.grass[0]};--g2:${p.grass[1]};--g3:${p.grass[2]};--light:${p.light};--rim:${p.rim};--lamp:${p.lamp};--ink:${p.ink};--soft:${p.soft};--clear:${p.clear}`

const fam = Object.entries(FAMILY_COLOR).map(([f, c]) => `--${f}:${c}`).join(';')
const rar = Object.entries(RARITY_COLOR).map(([r, c]) => `--${r}:${c}`).join(';')

const HOUR_CSS = `:root{${palVars(HOUR_PAL.dusk)}}
${(['morning', 'afternoon', 'night'] as const).map(h => `html[data-hour=${h}]{${palVars(HOUR_PAL[h])}}`).join('\n')}
@media (prefers-color-scheme:dark){${(['morning', 'afternoon'] as const).map(h => `html[data-hour=${h}]:not([data-scheme=light]){${palVars(HOUR_PAL[`${h}-dark`])}}`).join('')}}
${(['morning', 'afternoon'] as const).map(h => `html[data-hour=${h}][data-scheme=dark]{${palVars(HOUR_PAL[`${h}-dark`])}}`).join('\n')}`

// ---- the stylesheet ----------------------------------------------------------------------------

export const CSS = `${HOUR_CSS}
:root{color-scheme:light dark;${fam};${rar};--mythic:${MYTHIC_COLOR};--gold:${RARITY_COLOR.legendary};
--far:color-mix(in srgb,var(--peaks) 55%,var(--sky4));--pedge:color-mix(in srgb,var(--path) 60%,var(--hill));
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,"SF Mono","Cascadia Mono","Segoe UI Mono",Menlo,Consolas,monospace;
--ap:3px;--gp:.1875rem;--ease:cubic-bezier(.2,.8,.2,1);--spring:cubic-bezier(.34,1.56,.64,1);
--s1:4px;--s2:8px;--s3:16px;--s4:32px;--s5:64px;--s6:128px;
--night:#14121c;--cream:#fffdf5;--inkd:#1d1726;--soil:#2a1d18;--paper:#f4ecdc;--pink:#2a1d18;--psoft:#5e4a3c;--pline:#dccdb0}
@media (min-width:1024px){:root{--ap:4px}}
@media (prefers-color-scheme:dark){:root{--paper:#231915;--pink:#f4e9dc;--psoft:#cdb9a6;--pline:#3e2d25}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:var(--night);--hdr:64px;scroll-padding-top:calc(var(--hdr) + 16px)}
@media (max-width:767px){html{--hdr:88px}}
body{margin:0;background:var(--paper);color:var(--pink);font:400 1.0625rem/1.6 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:clip}
svg{display:block}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:.22em}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--inkd);outline-offset:3px}
.dark :focus-visible,.top :focus-visible,.foot :focus-visible{outline-color:var(--cream)}
h1,h2,h3{margin:0;line-height:1.3;text-wrap:balance}
h3{font-size:1.25rem;font-weight:700}
p{margin:0;max-width:62ch}
code,pre{font-family:var(--mono);font-size:.9375rem}
button{font:inherit;color:inherit}
.wrap{width:100%;max-width:1184px;margin-left:auto;margin-right:auto;padding-left:16px;padding-right:16px}
@media (min-width:768px){.wrap{padding-left:32px;padding-right:32px}}
html{overflow-x:clip}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.mark{font-variant-emoji:text}
.soft{color:var(--soft)}
html:not(.js) .js-only{display:none!important}
.defs{position:absolute;width:0;height:0;overflow:hidden}

/* pixel type: one svg per word, sized by --gp (one glyph pixel); headings use the bold cut (.bd) */
.pt{display:block;font-size:0;line-height:0}
.pt .pw{display:inline-block;vertical-align:top;width:calc(var(--w) * var(--gp));height:calc(9 * var(--gp));margin:0 calc(3 * var(--gp)) calc(2 * var(--gp)) 0}
.pt .pw.bd{width:calc(var(--w) * var(--gp) / 2);height:calc(10 * var(--gp));margin:0 calc(3 * var(--gp)) calc(3 * var(--gp)) 0}
.pt .pw:last-child,.pt .pw.bd:last-child{margin-right:0}
.pw g{transform-box:fill-box}
.pw.bd .sh{fill:var(--hsh,currentColor);fill-opacity:var(--sho,.34)}
h1 .pt{--gp:3px}
@media (min-width:768px){h1 .pt{--gp:4px}}
@media (min-width:1024px){h1 .pt{--gp:6px}}
h2 .pt{--gp:3px}
@media (min-width:768px){h2 .pt{--gp:4px}}
h1:has(.pt),h2:has(.pt){line-height:0}

/* scenery: fixed art-pixel sizes, centred, never scaled to fit */
.dz{display:block;width:calc(1000 * var(--ap));height:calc(var(--ah) * var(--ap));margin-left:calc(50% - 500 * var(--ap))}
.k1{fill:var(--sky1)}.k2{fill:var(--sky2)}.k3{fill:var(--sky3)}.k4{fill:var(--sky4)}.kp{fill:var(--peaks)}.kq{fill:var(--far)}.kh{fill:var(--hill)}
.ka{fill:var(--path)}.ke{fill:var(--pedge)}.g1{fill:var(--g1)}.g2{fill:var(--g2)}.g3{fill:var(--g3)}.kl{fill:var(--lamp)}.kr{fill:var(--rim)}.kc{fill:var(--clear)}
.so{fill:#2a1d18}.rt{fill:#4a3326}.st{fill:#3a2a22}.ng{fill:#1d3a30}.nt{fill:#142039}.nr{fill:#0f1830}.nf{fill:#0a1226}.nw{fill:#ffcf6a}.nx{fill:#2c3552}.ln{fill:#0a0f20}.lp{fill:#2a2433}
.cg{fill:#1b2b2a}.cd{fill:#121b20}.fo{fill:#1f1512}.ct{fill:#0f1626}.rb{fill:#252c3d}.rh{fill:#323a4f}

/* sprites: layered svg (pages-sprite.ts) */
.spr{overflow:visible}
.spr .ld,.spr .fl{opacity:0}
.spr.shut .e,.spr.blink .e{opacity:0}.spr.shut .ld,.spr.blink .ld{opacity:1}
.spr.flash .b,.spr.flash .e,.spr.flash .ld{opacity:0}.spr.flash .fl{opacity:1}
.spr.sil .b path,.spr.sil .e path{fill:var(--silc,#2b2937)}.spr.sil .ld{opacity:0}
.spr .e{transition:none}
.spr.away .e,.spr.away .ld{opacity:0}

/* the pixel button: game material, notched, with a 4 px drop */
.pbtn{position:relative;display:inline-flex;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;min-height:48px;vertical-align:top}
.pbtn .face{display:flex;align-items:center;justify-content:center;gap:var(--s2);width:100%;min-height:44px;padding:0 var(--s3);background:var(--cream);color:var(--inkd);
border:2px solid var(--inkd);border-bottom-width:6px;font:700 1rem/1 var(--sans);white-space:nowrap;
clip-path:polygon(0 var(--ap),var(--ap) var(--ap),var(--ap) 0,calc(100% - var(--ap)) 0,calc(100% - var(--ap)) var(--ap),100% var(--ap),100% calc(100% - var(--ap)),calc(100% - var(--ap)) calc(100% - var(--ap)),calc(100% - var(--ap)) 100%,var(--ap) 100%,var(--ap) calc(100% - var(--ap)),0 calc(100% - var(--ap)))}
.pbtn:active .face,.pbtn.down .face{transform:translateY(4px);border-bottom-width:2px;margin-bottom:4px}
.pbtn:hover .face{background:#fff}
.tbtn{padding:var(--s2) 0;border:0;background:none;color:inherit;font:600 1rem/1.4 var(--sans);text-decoration:underline;text-underline-offset:.22em;cursor:pointer;min-height:44px}
.kc1{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 6px;background:var(--cream);color:var(--inkd);border:2px solid var(--inkd);border-bottom-width:4px;font:700 .875rem/1 var(--mono)}

/* the prompt box: a UI overlay, smooth */
.prompt{position:relative;display:flex;align-items:center;gap:12px;min-height:64px;padding:12px 12px 12px 20px;border-radius:14px;background:#14121c;border:1px solid #2e2a3d;color:#f4f2fb}
.prompt .gt{display:inline-block;width:1.5em;text-indent:0;font-weight:700;color:#8f8aa8}
.prompt pre{flex:1;margin:0;padding:0 0 0 1.5em;text-indent:-1.5em;background:none;border:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:1rem;line-height:1.55}
.prompt code{user-select:all;-webkit-user-select:all;cursor:text}
.prompt code .w{white-space:nowrap}
.prompt code::selection,.prompt code ::selection{background:#4f8ff0;color:#fff}
.prompt .caret{display:inline-block;width:.6em;height:1.15em;margin-left:2px;vertical-align:-.2em;background:#fffdf5;animation:caret 1.1s steps(1) infinite}
@keyframes caret{50%{opacity:0}}
.prompt .copy{flex:none}
@media (max-width:599px){.prompt{flex-wrap:wrap;padding:16px}.prompt .copy{width:100%}.prompt .copy .face{min-height:48px}}

/* header */
.skip{position:absolute;left:16px;top:-80px;z-index:50;padding:8px 16px;background:var(--cream);color:var(--inkd);font-weight:700}
.skip:focus{top:8px}
.top{position:relative;z-index:30;color:#f4f2fb;background:#14121c}
html.js .top{position:sticky;top:0}
.top .in{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:var(--s3);height:64px}
.brand{display:flex;align-items:center;min-height:44px;color:inherit;text-decoration:none}
.brand svg{width:calc(var(--w) * 3px);height:30px}
.brand .dot{transition:none}
.trail{position:relative;display:flex;align-items:center;justify-content:center;gap:0;min-width:0;height:44px}
.trail a{position:relative;z-index:1;display:flex;align-items:center;min-height:44px;padding:0 10px;color:inherit;opacity:.78;font-size:.9375rem;font-weight:600;text-decoration:none;white-space:nowrap}
.trail a:hover{opacity:1;text-decoration:underline}
.trail a[aria-current]{opacity:1}
.trail .dots{flex:1 1 24px;max-width:72px;height:var(--ap);background:repeating-linear-gradient(90deg,currentColor 0 var(--ap),transparent 0 calc(3 * var(--ap)));opacity:.5}
.walker{position:absolute;left:0;bottom:-2px;z-index:2;width:16px;height:16px;pointer-events:none;transform:translateX(var(--wx,0px));opacity:0}
.walker svg{width:16px;height:16px}
html.js .home .walker.on{opacity:1}
.walker.up svg{transform:scaleX(-1)}
.walker .zz{position:absolute;left:12px;top:-10px;width:8px;height:12px;opacity:0;color:#fffdf5}
.team{display:flex;gap:4px}
.slot{position:relative;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;background:none;cursor:pointer}
.slot .in2{display:grid;place-items:center;width:36px;height:36px;background:#221f2e;border:2px solid #3a3550}
.slot svg.spr{width:24px;height:24px}
.slot.empty .in2{background:none;border:2px dashed #6e6888;color:#b7b2cc;--silc:#4d4766}
.slot.empty .in2 .pw{width:15px;height:27px}
.slot:not(.empty):hover .in2{border-color:#8f88ad}
.slot.flash .in2{background:#fffdf5}
.home .top{background:var(--sky1);color:var(--ink)}
.home .top.solid{background:#14121c;color:#f4f2fb}
.top .hdz{position:absolute;left:0;right:0;top:100%;overflow:hidden;height:calc(2 * var(--ap));opacity:0;pointer-events:none}
.top .hdz path{fill:#14121c}
.home .top.solid .hdz,body:not(.home) .top .hdz{opacity:1}
@media (max-width:767px){
.top .in{grid-template-columns:1fr auto;grid-template-rows:56px 32px;height:88px;row-gap:0}
.brand svg{width:calc(var(--w) * 2px);height:20px}
.trail{grid-column:1/-1;grid-row:2;height:32px;justify-content:space-between}
.trail a{min-height:32px;padding:0 4px;font-size:.875rem}
.trail .dots{max-width:none}
.slot{width:36px;height:44px}.slot .in2{width:32px;height:32px}.slot svg.spr{width:24px;height:24px}
}

/* footer */
.foot{position:relative;margin-top:0;background:#1f1512;color:#cdb9a6;font-size:.9375rem}
.foot .edge{display:block;width:calc(1000 * var(--ap));height:calc(8 * var(--ap));margin-left:calc(50% - 500 * var(--ap))}
.foot .in{display:grid;gap:var(--s3);padding-top:var(--s4);padding-bottom:var(--s5)}
.foot nav{display:flex;flex-wrap:wrap;gap:0 var(--s3)}
.foot nav a{display:inline-flex;align-items:center;min-height:44px;color:#f4e9dc}
.foot .napper{position:absolute;right:max(16px,calc(50% - 560px));top:calc(-64px + 3 * var(--ap));width:64px;height:64px;padding:0;border:0;background:none;cursor:pointer}
.foot .napper svg.spr{width:64px;height:64px}
.foot .zzz{position:absolute;right:-4px;top:-6px;width:10px;height:18px;color:#cdb9a6;animation:zz 2s steps(4) infinite}
.foot .napper.awake .zzz{visibility:hidden}
.foot .nsay{position:absolute;right:calc(100% + 6px);top:4px;padding:3px 10px 4px;background:#fffdf5;color:#1d1726;font:700 .8125rem/1.3 var(--sans);white-space:nowrap;opacity:0;pointer-events:none}
.foot .napper.awake .nsay{opacity:1}
.foot .zzz svg{width:10px;height:18px}
@keyframes zz{0%{transform:translateY(0);opacity:0}25%{opacity:1}100%{transform:translateY(-12px);opacity:0}}
.foot .keys{justify-self:start;display:inline-flex;align-items:center;gap:10px}
.foot .keys::after{content:"";width:28px;height:16px;background:linear-gradient(#cdb9a6,#cdb9a6) 3px 50%/10px 10px no-repeat,#3b2a22;box-shadow:inset 0 0 0 2px #cdb9a6}
.foot .keys[aria-pressed=true]::after{background:linear-gradient(#1f1512,#1f1512) 15px 50%/10px 10px no-repeat,#9ed36a}

/* the card face (SPEC 21): one component, full and tile. A pixel frame in the family's colour, lit
   top-left and shaded bottom-right, a rarity line inside it, and the rarity as a gem and a word */
.cf{--rar:var(--common);--fd:color-mix(in srgb,var(--fam) 55%,#1d1726);position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 10px 12px;background:#fffdf5;color:#1d1726;text-align:center;
border:6px solid var(--fam);border-right-color:var(--fd);border-bottom-color:var(--fd);box-shadow:inset 0 0 0 2px var(--rar);
clip-path:polygon(0 6px,6px 6px,6px 0,calc(100% - 6px) 0,calc(100% - 6px) 6px,100% 6px,100% calc(100% - 6px),calc(100% - 6px) calc(100% - 6px),calc(100% - 6px) 100%,6px 100%,6px calc(100% - 6px),0 calc(100% - 6px))}
.cf.foil{border-color:transparent;background:linear-gradient(#fffdf5,#fffdf5) padding-box,linear-gradient(135deg,#ff7ac6,#f2b33d,#9ed36a,#5b8def,#a874e8,#ff7ac6) border-box}
@property --ang{syntax:"<angle>";inherits:false;initial-value:0deg}
.cf.mythic{box-shadow:inset 0 0 0 2px #f2b33d,inset 0 0 0 4px #fffdf5,inset 0 0 0 6px var(--mythic);background:linear-gradient(#fffdf5,#fffdf5) padding-box,conic-gradient(from var(--ang),#ff7ac6,#f2b33d,#fff1c2,#9ed36a,#5bd0ef,#a874e8,#ff7ac6) border-box;animation:myth 4.8s steps(24) infinite}
@keyframes myth{to{--ang:360deg}}
.cf-art{position:relative;display:grid;place-items:center;width:100%;padding:var(--s2) 0 0;background:var(--psky,#eef2ea);border-bottom:4px solid var(--fam)}
.cf-art .spr{width:calc(16 * var(--cs,4px));height:calc(16 * var(--cs,4px))}
.cf.shiny .cf-art::before,.cf.shiny .cf-art::after{content:"";position:absolute;width:3px;height:3px;left:16%;top:18%;background:#fff6c9;pointer-events:none;
box-shadow:-3px 0 #f2b33d,3px 0 #f2b33d,0 -3px #f2b33d,0 3px #f2b33d;animation:twk 1.8s steps(1) infinite}
.cf.shiny .cf-art::after{left:auto;right:18%;top:52%;animation-delay:-.9s}
@keyframes twk{0%,45%{opacity:1}50%,100%{opacity:0}}
.cf-name{margin-top:var(--s2);font-weight:800;font-size:1.125rem;line-height:1.3;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cf-name .pt{--gp:2px;white-space:normal;color:#1d1726;--sho:.22}
.cf-name:has(.pt){line-height:0;overflow:visible;white-space:normal;padding:2px 0}
.cf-rar{font-size:.875rem;font-weight:700;color:#1d1726}
.cf-rar::before{content:"";display:inline-block;width:10px;height:10px;margin-right:6px;vertical-align:-1px;background:linear-gradient(135deg,#ffffffa0 0 34%,#0000 34%),var(--rar);
clip-path:polygon(40% 0,60% 0,60% 20%,80% 20%,80% 40%,100% 40%,100% 60%,80% 60%,80% 80%,60% 80%,60% 100%,40% 100%,40% 80%,20% 80%,20% 60%,0 60%,0 40%,20% 40%,20% 20%,40% 20%)}
.cf-kind{font-size:.8125rem;color:#4a4458}
.cf-kind .lv{margin-left:6px;color:#1d1726;font-weight:600}
.cf-row{display:flex;align-items:center;gap:var(--s2);width:100%;margin-top:2px;font-size:.8125rem;color:#4a4458;text-align:left}
.cf-row b{color:#1d1726;white-space:nowrap}
.bar{flex:1;min-width:24px;height:8px;background:#e7e2ee;border:2px solid #1d1726}
.bar i{display:block;height:100%;width:var(--v);background:var(--bc,#3d3458);transform-origin:left;transition:width .5s var(--ease)}
.cf-traits{list-style:none;margin:var(--s1) 0 0;padding:0;width:100%;font-size:.8125rem;text-align:left;color:#4a4458}
.cf-traits b{color:#1d1726}
.cf-stamps{display:flex;flex-wrap:wrap;justify-content:center;gap:var(--s1);margin-top:2px}
.cf-stamps span{padding:1px 8px 2px;background:#1d1726;color:#fffdf5;font-size:.75rem;font-weight:700}
.cf .holo{position:absolute;inset:0;pointer-events:none;opacity:0;mix-blend-mode:color-dodge;
background:linear-gradient(115deg,transparent calc(var(--hx,50%) - 15%),#ff7ac6 calc(var(--hx,50%) - 9%),#f2b33d calc(var(--hx,50%) - 3%),#9ed36a var(--hx,50%),#5b8def calc(var(--hx,50%) + 6%),#a874e8 calc(var(--hx,50%) + 12%),transparent calc(var(--hx,50%) + 15%))}
.cf.foil.tilting .holo,.cf.shiny.tilting .holo{opacity:.4}
@property --hx{syntax:"<percentage>";inherits:true;initial-value:50%}
.cf.sweep .holo{opacity:.5;animation:holo .45s linear}
@keyframes holo{from{--hx:-20%}to{--hx:120%}}
.cf.shiny .holo{background:linear-gradient(115deg,transparent calc(var(--hx,50%) - 14%),#fff6c9 calc(var(--hx,50%) - 4%),#f2b33d var(--hx,50%),#fff6c9 calc(var(--hx,50%) + 4%),transparent calc(var(--hx,50%) + 14%))}
.cf.foil.shiny .holo{background:linear-gradient(115deg,transparent calc(var(--hx,50%) - 15%),#ff7ac6 calc(var(--hx,50%) - 9%),#f2b33d calc(var(--hx,50%) - 3%),#fff6c9 var(--hx,50%),#5b8def calc(var(--hx,50%) + 6%),#a874e8 calc(var(--hx,50%) + 12%),transparent calc(var(--hx,50%) + 15%))}
.tile .cf{padding:6px 8px 12px;--cs:4px}
.tile .cf-name{font-size:1rem}
.big .cf-name .pt,.cf.big .cf-name .pt{--gp:3px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
html[data-motion=reduce] *,html[data-motion=reduce] *::before,html[data-motion=reduce] *::after{animation:none!important;transition:none!important}
html[data-hidden] *{animation-play-state:paused!important}

`

/** Quiet pages (the almanac, privacy, "not here"): prose and tables on paper. */
export const PAPER_CSS = `
/* quiet pages: prose on paper */
.paperpage{padding-top:var(--s5);padding-bottom:var(--s6)}
.paperpage>*{max-width:720px}
.paperpage h1{font-size:clamp(2rem,1.5rem + 2vw,2.75rem);line-height:1.15;font-weight:800}
.paperpage h2{font-size:1.5rem;font-weight:800;margin-top:var(--s5);margin-bottom:var(--s3)}
.paperpage h3{margin-top:var(--s4);margin-bottom:var(--s2)}
.paperpage .lede{margin-top:var(--s3);font-size:1.25rem;line-height:1.5;color:var(--psoft)}
.paperpage p+p{margin-top:var(--s3)}
.paperpage ul{padding-left:1.25em;margin:var(--s3) 0 0}
.paperpage li+li{margin-top:var(--s2)}
.table{width:100%;max-width:720px;border-collapse:collapse;margin-top:var(--s3);font-size:.9375rem}
.table th,.table td{text-align:left;padding:10px var(--s2) 10px 0;border-bottom:2px solid var(--pline);vertical-align:top}
.table th{font-weight:700}
.table th.n{text-align:right;padding-right:0}
.table td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-right:0}
.tablewrap{overflow-x:auto}
`

/** The strip of a family place at the top of a site page. */
export const PLACE_CSS = `
.place{position:relative;height:calc(64 * var(--ap));overflow:hidden;background:var(--psky)}
.place .placeart{position:absolute;bottom:0}
.place .ph{fill:var(--pshade)}.place .pg{fill:var(--pground)}.place .pf{fill:color-mix(in srgb,var(--pshade) 30%,var(--psky))}
`

// ---- the page ----------------------------------------------------------------------------------

export type PageKind = 'home' | 'site' | 'plain' | 'passkey'

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
  /** home: the landing; site: other script pages; plain: no script; passkey: passkey.js only */
  kind?: PageKind
  /** a fixed hour (postcards): sky.js keeps it */
  hour?: string
  /** the server's clock, for the footer's season line */
  now?: number
  /** dev preview: data-scheme / data-motion on <html> */
  scheme?: 'dark' | 'light'
  motion?: 'reduce'
  /** the landing's team strip */
  team?: boolean
  /** the landing's world JSON for <main data-world> */
  world?: string
  mainClass?: string
  status?: number
  cache?: string
  /** @deprecated use kind: 'passkey' */
  script?: boolean
}

let FAVICON_CACHE = ''
/** A sleepy regular's face, 8x8, as the default favicon. */
function favicon(): string {
  if (!FAVICON_CACHE) {
    const px = miniSprite(spriteFor(regularCard({ now: 0, season: 1, regulars: regulars() } as never, 'haiku', 0)))
    let d = ''
    const by = new Map<number, string>()
    px.forEach((r, y) => r.forEach((c, x) => { if (c >= 0) by.set(c, (by.get(c) ?? '') + `M${x} ${y}h1v1h-1z`) }))
    for (const [c, p] of by) d += `<path fill="#${c.toString(16).padStart(6, '0')}" d="${p}"/>`
    FAVICON_CACHE = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${d}</svg>`)
  }
  return FAVICON_CACHE
}

export function layout(o: PageOptions): Response {
  const kind: PageKind = o.kind ?? (o.script ? 'passkey' : 'plain')
  const url = o.origin + o.path
  const og = o.og
  const scripted = kind === 'home' || kind === 'site'
  const attrs = [
    o.hour ? html` data-hour="${o.hour}" data-hour-fixed` : '',
    o.scheme ? html` data-scheme="${o.scheme}"` : '',
    o.motion ? html` data-motion="${o.motion}"` : '',
  ]
  const doc = html`<!doctype html>
<html lang="en"${attrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<meta name="description" content="${o.description}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#14121c">
${o.noindex ? html`<meta name="robots" content="noindex">` : ''}
<link rel="icon" href="${favicon()}">
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
${scripted ? html`<script src="/static/${SITE_ASSETS.sky}"></script>` : ''}
<style>${raw(CSS + (o.css ?? ''))}</style>
${kind === 'passkey' ? html`<script src="/static/passkey.js" defer></script>` : ''}
${scripted ? html`<script type="module" src="/static/${SITE_ASSETS.site}"></script>` : ''}
</head>
<body class="${kind === 'home' ? 'home' : kind}">
${raw(boldDefs(o.body.__html))}
${kind === 'home' ? html`<a class="skip" href="#install-cmd">Skip to the install command</a><a class="skip js-only" href="#meet" data-meetskip>Meet the wild one</a>` : ''}
${header(kind, o.team === true)}
<main id="main"${o.mainClass ? html` class="${o.mainClass}"` : ''}${o.world ? html` data-world="${o.world}"` : ''}>
${o.body}
</main>
${footer(o.now ?? Date.now(), scripted)}
</body>
</html>
`
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': o.cache ?? 'no-store',
    'Content-Security-Policy': kind === 'passkey' ? SCRIPT_CSP : scripted ? SITE_CSP : PAGE_CSP,
  }
  if (kind === 'passkey') headers['Cross-Origin-Opener-Policy'] = 'same-origin'
  return new Response(doc.__html, { status: o.status ?? 200, headers })
}

/** The wordmark in the pixel font, its two i-dots drawn apart so they can look around and blink. */
function wordmark(): string {
  const word = 'spinlings'
  const { at, w } = layoutWord(word)
  let body = '', dots = ''
  ;[...word].forEach((ch, i) => {
    if (ch === 'i') {
      body += `<path d="${glyphPath(ch, at[i]).replace(/^M\d+ 0h1v1h-1z/, '')}"/>`
      dots += `<path class="dot" d="M${at[i]! + 2} 0h1v1h-1z"/>`
    } else body += `<path d="${glyphPath(ch, at[i])}"/>`
  })
  return `<svg class="wm" viewBox="0 -1 ${w} 10" style="--w:${w}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body}<g class="eyes">${dots}</g></svg>`
}

const STOPS = [['battle', 'Battle'], ['collect', 'Collect'], ['trade', 'Trade'], ['install', 'Install']] as const

function header(kind: PageKind, team: boolean): Raw {
  const home = kind === 'home'
  return html`<header class="top" id="top">
<div class="in wrap">
<a class="brand" href="/" aria-label="Spinlings, home">${raw(wordmark())}</a>
<nav class="trail" aria-label="Sections">${STOPS.map(([id, label], i) => html`${i ? html`<span class="dots" aria-hidden="true"></span>` : ''}<a href="${home ? '' : '/'}#${id}" data-stop="${id}">${label}</a>`)}<span class="walker" aria-hidden="true"></span></nav>
${team ? html`<div class="team js-only" role="group" aria-label="Your team">
<button class="slot empty" type="button" data-slot="0" title="Meet the wild one to fill this spot." aria-label="Empty spot. Meet the wild one to fill this spot."><span class="in2">${raw(wordSvg('?', 'pw q'))}</span></button>
<button class="slot" type="button" data-slot="1"><span class="in2"></span></button>
<button class="slot" type="button" data-slot="2"><span class="in2"></span></button>
</div>` : ''}
</div>
<div class="hdz" aria-hidden="true">${raw(HEADER_DITHER)}</div>
</header>`
}

/** The header's ragged bottom edge once it turns solid: every other art pixel. */
const HEADER_DITHER = `<svg class="dz" viewBox="0 0 1000 2" style="--aw:1000;--ah:2" shape-rendering="crispEdges" focusable="false"><path d="${Array.from({ length: 500 }, (_, i) => `M${i * 2} 0h1v1h-1z`).join('')}"/></svg>`

let NAPPER = ''
function napper(): string {
  if (!NAPPER) NAPPER = spriteSvg(spriteFor(regularCard({ now: 0, season: 1, regulars: regulars() } as never, 'sonnet', 1, 1)), { cls: 'shut' })
  return NAPPER
}

function footer(now: number, scripted: boolean): Raw {
  const season = seasonOf(now)
  const day = Math.floor((now - seasonStart(season)) / 86_400_000) + 1
  return html`<footer class="foot dark">
${raw(footTopSvg().replace('class="edge foottop"', 'class="edge foottop"'))}
<button class="napper js-only" type="button" aria-label="A napping regular. Wake it.">${raw(napper())}<span class="zzz" aria-hidden="true">${raw(wordSvg('z', 'pw'))}</span></button>
${!scripted ? html`<span class="napper" aria-hidden="true">${raw(napper())}</span>` : ''}
<div class="in wrap">
<p>A creature card game for Claude Code. Free and open source. Not affiliated with Anthropic.</p>
<p>Season ${season}, day ${day}.</p>
<nav aria-label="More"><a href="/odds">Odds</a><a href="/privacy">Privacy</a><a href="${REPO}">Source code</a><a href="${REPO}/issues">Report a problem</a><a href="${REPO}/blob/main/SECURITY.md">Report a security issue</a><a href="${REPO}/blob/main/docs/self-hosting.md">Run your own server</a></nav>
${scripted ? html`<button class="tbtn keys js-only" type="button" aria-pressed="true" data-keys>Key shortcuts</button>` : ''}
</div>
</footer>`
}

/**
 * A command to type, as one selectable line: one click selects it all, and it wraps only between
 * words, so `--marketplace` never splits. The copied text is exactly the command.
 */
export const command = (line: string): Raw => html`<code>${line.split(' ').map((w, i) => html`${i ? ' ' : ''}<span class="w">${w}</span>`)}</code>`

/** The install sign: the prompt box with the one line and a Copy button (SPEC 34). */
export function installBlock(id = 'install', label = 'Type this inside Claude Code'): Raw {
  return html`<div class="install" data-install>
<p class="label" id="${id}-label">${label}</p>
<div class="prompt"><pre id="${id}-cmd" aria-labelledby="${id}-label" tabindex="-1">${GT}${command(INSTALL)}<span class="caret" aria-hidden="true"></span></pre>
${COPY}</div>
<p class="ask">Or just ask Claude: <q>${ASK}</q></p>
</div>`
}

const GT = raw('<span class="gt" aria-hidden="true">&gt;</span>')
const COPY = raw('<button class="pbtn copy js-only" type="button" data-copy><span class="face">Copy</span></button>')

/** Any other line to type inside Claude Code (claim, redeem, trade), in the same prompt box with Copy. */
export const promptLine = (line: string, label: string): Raw =>
  html`<div class="prompt"><pre aria-label="${label}">${GT}${command(line)}</pre>${COPY}</div>`

/** A heading in the bold pixel cut when every character has a glyph, else plain words. */
export const heading = (words: string): Raw | string => (pixelable(words) ? pixelHeading(words) : words)

/** A notice page: expired links, unknown handles, ended drops. */
export function notice(o: Omit<PageOptions, 'body' | 'description'> & { heading: string; lines: Value[]; extra?: Raw }): Response {
  return layout({
    ...o,
    description: o.heading,
    noindex: true,
    css: (o.css ?? '') + PAPER_CSS + NOTICE_CSS,
    mainClass: 'notice',
    body: html`<section class="wrap paperpage"><div class="tuft404" aria-hidden="true">${raw(peeker(o.now ?? Date.now()))}${raw(TUFT404)}</div><h1>${heading(o.heading)}</h1>${o.lines.map(l => html`<p>${l}</p>`)}${o.extra ?? ''}</section>`,
  })
}

const TUFT404 = (() => {
  const rows = ['......1....1....', '..1...12..12..1.', '..12.122..22.12.', '.122.2222122.22.', '.2222222222222..', '1222223222322221', '2223222232222322', '2322232222223222', '2222222222222222']
  const by: Record<string, string> = { '1': '', '2': '', '3': '' }
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (by[c] !== undefined) by[c] += `M${x} ${y}h1v1h-1z` }))
  return `<svg class="tuftart" viewBox="0 0 16 9" shape-rendering="crispEdges"><g class="sway"><path fill="#9ed36a" d="${by['1']}"/></g><path fill="#5f9f4a" d="${by['2']}"/><path fill="#3f7a3a" d="${by['3']}"/></svg>`
})()

/**
 * A regular hiding in the "not here" tuft: a different one each day, and the same one on every
 * missing page that day, so the page never tells one kind of "not here" from another.
 */
function peeker(now: number): string {
  const all = regulars()
  return `<span class="peek404">${spriteSvg(spriteFor({ form: all[Math.floor(now / 86_400_000) % all.length]!, stage: 1 }))}</span>`
}

const NOTICE_CSS = `
body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
main.notice{flex:1 0 auto}
.notice{background:var(--paper)}
.notice .paperpage{padding-top:var(--s5)}
.tuft404{position:relative;width:128px;height:96px;margin-bottom:var(--s4);overflow:hidden}
.tuft404 .tuftart{position:absolute;left:0;bottom:0;width:128px;height:72px;z-index:1}
.peek404{position:absolute;left:32px;bottom:24px;width:64px;height:64px}
.peek404 .spr{width:64px;height:64px;animation:peek 6s steps(1) infinite}
.peek404 .spr .ld{animation:lids 6s steps(1) infinite}.peek404 .spr .e{animation:eyes 6s steps(1) infinite}
@keyframes peek{0%,30%{transform:translateY(40px)}34%,80%{transform:translateY(-22px)}84%,100%{transform:translateY(40px)}}
.tuft404:hover .peek404 .spr{animation:none;transform:translateY(-22px)}
@keyframes lids{0%,56%,60%,100%{opacity:0}57%,59%{opacity:1}}
@keyframes eyes{0%,56%,60%,100%{opacity:1}57%,59%{opacity:0}}
.tuft404:hover .sway{animation:sway .3s steps(2) 3}
@keyframes sway{50%{transform:translateX(1px)}}
.notice h1{color:var(--pink);--hsh:#3f7a3a;--sho:.55}
.notice p{margin-top:var(--s3);color:var(--psoft)}
.notice .back{font-weight:700}
`

// ---- cards -------------------------------------------------------------------------------------

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export const isMythic = (c: BattleCard) => c.species === 'mythic'
export const rarityWord = (c: BattleCard) => (isMythic(c) ? 'Mythic' : cap(c.rarity))
export const rarityColor = (c: BattleCard) => (isMythic(c) ? MYTHIC_COLOR : RARITY_COLOR[c.rarity])
export const finalForm = (c: BattleCard) => c.stage === 3 && (isMythic(c) || c.rarity === 'legendary' || c.form?.legendary === true)

export const familyStyle = (c: Pick<BattleCard, 'family'>) => `--fam:${FAMILY_COLOR[c.family]}`

/**
 * What else a card is, in words (never colour alone, SPEC 21.9). Finishes live in the rarity line.
 * A first discovery never names its finder here (SPEC 20.8), and a Mythic names its finder only
 * while the loaders still do: once they reroll or leave, it was found by "a trainer". The full card
 * spells the first discovery out; the tile keeps it short.
 */
export function stamps(c: BattleCard, o: { full?: boolean } = {}): string[] {
  const out: string[] = []
  if (c.firstFind) out.push(`${MARK.first} ${o.full ? 'First found by a trainer' : 'First discovered'}`)
  if (isMythic(c)) out.push(`${MARK.mythic} Mythic, 1 of 1`)
  if (c.form?.kind === 'mythic') out.push(`Discovered by ${c.form.discoveredBy ? text(c.form.discoveredBy, 40) : 'a trainer'}`)
  if (c.form?.kind === 'promo' && c.form.stamp) out.push(text(c.form.stamp, 40))
  return out
}

/** The rarity line (SPEC 14): "Rare", "Rare · Foil", "Rare · Shiny Foil". */
export const rarityLine = (c: Pick<BattleCard, 'species' | 'rarity' | 'shiny' | 'foil'>) => {
  const fin = [c.shiny ? 'Shiny' : '', c.foil ? 'Foil' : ''].filter(Boolean).join(' ')
  return `${rarityWord(c as BattleCard)}${fin ? ` · ${fin}` : ''}`
}

/** What the gene bar means, on hover. */
export const GENE_TIP = 'How good its four genes are. Each gene lifts or lowers one stat by up to 12%.'

export type FaceOptions = { big?: boolean; level?: boolean; genes?: boolean; traits?: boolean; stamps?: boolean; dna?: boolean; poke?: boolean }

/**
 * The card face (SPEC 21's one component), server-side; the client builds the same markup in card.ts.
 * A big face names the creature in the bold pixel cut.
 */
export function cardFace(c: BattleCard, o: FaceOptions = {}): Raw {
  const name = text(cardName(c), 48)
  const g = geneScore(c.genes)
  const cls = `cf${o.big ? ' big' : ''}${c.foil ? ' foil' : ''}${c.shiny ? ' shiny' : ''}${isMythic(c) ? ' mythic' : ''}`
  const art = o.poke
    ? html`<button class="poke js-only" type="button" aria-label="${name}. Poke it.">${raw(spriteSvg(spriteFor(c)))}</button><span class="nojs">${raw(spriteSvg(spriteFor(c), { label: name }))}</span>`
    : raw(spriteSvg(spriteFor(c)))
  const marks = o.stamps ? stamps(c) : []
  return html`<div class="${cls}" style="${familyStyle(c)};--rar:${rarityColor(c)};--psky:${PLACE[c.family][0]}">
<div class="cf-art">${art}</div>
<p class="cf-name">${o.big && pixelable(name) ? raw(boldWords(name)) : name}</p>
<p class="cf-rar">${rarityLine(c)}</p>
<p class="cf-kind"><span class="mark" aria-hidden="true">${FAMILY_MARK[c.family]}</span> ${FAMILY_INFO[c.family].name}${o.level ? html`<span class="lv">Level ${c.level}</span>` : ''}</p>
${o.dna ? html`<p class="cf-dna" role="img" aria-label="Its colours">${dnaSwatches(c).map(col => html`<i style="--c:${col}"></i>`)}</p>` : ''}
${o.genes ? html`<p class="cf-row genes" title="${GENE_TIP}"><b>Gene quality ${g}%</b><span class="bar"><i style="--v:${g}%"></i></span></p>` : ''}
${o.traits && c.traits.length ? html`<p class="cf-kind traits">${c.traits.map(t => TRAITS[t]?.name ?? t).join(', ')}</p>` : ''}
${marks.length ? html`<p class="cf-stamps">${marks.map(s => html`<span>${s}</span>`)}</p>` : ''}
<span class="holo" aria-hidden="true"></span>
</div>`
}

/** The tile: art, name, rarity, family and level (SPEC 21's one card component). */
export function cardTile(c: BattleCard, o: { link?: boolean } = {}): Raw {
  const name = text(cardName(c), 40)
  const face = cardFace(c, { level: true, stamps: true })
  return html`<li class="tile">${o.link ? html`<a class="cardlink" href="/c/${c.id}" aria-label="${name}, ${rarityLine(c)}">${face}</a>` : face}</li>`
}

export const cardTiles = (cards: readonly BattleCard[], o: { link?: boolean } = {}): Raw =>
  html`<ul class="cards">${cards.map(c => cardTile(c, o))}</ul>`

/**
 * A card's DNA as colour: the few colours its genes painted it in, most-used first (outline, eyes and
 * catchlights left out), so two cards of one species visibly differ side by side.
 */
export function dnaSwatches(c: BattleCard, n = 5): string[] {
  const count = new Map<number, number>()
  for (const row of spriteFor(c)) for (const v of row) if (v >= 0 && v !== EYE && v !== SHINE) count.set(v, (count.get(v) ?? 0) + 1)
  const lum = (v: number) => ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11
  return [...count].filter(([v]) => lum(v) > 28).sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => '#' + v.toString(16).padStart(6, '0'))
}

/**
 * The full card page: the card itself is the hero (the same face as everywhere, big, tilting and, for
 * foil and shiny, shimmering under the pointer). The plaque beside it holds only what the face does
 * not: its stats, its traits and its story (form, season, finds and stamps).
 */
export function fullCard(c: BattleCard): Raw {
  const name = text(cardName(c), 48)
  const st = c.stats
  const marks = stamps(c, { full: true })
  return html`<article class="full" style="${familyStyle(c)};--rar:${rarityColor(c)}">
<div class="bigcard${isMythic(c) ? ' mythic' : ''}" data-bigcard>${cardFace(c, { big: true, poke: true, level: true, genes: true, dna: true })}</div>
<div class="plaque">
<h1>${heading(name)}</h1>
<p class="sr">${rarityLine(c)}, ${FAMILY_INFO[c.family].name} creature. Gene quality ${geneScore(c.genes)}%.</p>
<ul class="story">
<li>Level ${c.level}. ${finalForm(c) ? 'Final form.' : `Stage ${c.stage} of 3.`}</li>
<li>Season ${c.season}.</li>
${marks.map(s => html`<li${s.startsWith(MARK.first) || s.startsWith(MARK.mythic) ? html` class="seal"` : ''}>${s}</li>`)}
</ul>
<dl class="stats"><div><dt>HP</dt><dd>${st.hp}</dd></div><div><dt>Attack</dt><dd>${st.atk}</dd></div><div><dt>Defense</dt><dd>${st.def}</dd></div><div><dt>Speed</dt><dd>${st.spd}</dd></div></dl>
${c.traits.length ? html`<ul class="traits">${c.traits.map(t => html`<li><strong>${TRAITS[t]?.name ?? t}</strong> <span>${TRAITS[t]?.text ?? ''}</span></li>`)}</ul>` : ''}
</div>
</article>`
}

export const FULL_CSS = `
.full{display:grid;gap:var(--s5);align-items:center}
@media (min-width:860px){.full{grid-template-columns:340px minmax(0,1fr);gap:var(--s5)}}
.bigcard{position:relative;display:grid;place-items:center;perspective:900px;padding:var(--s4) 0}
.bigcard.mythic::before{content:"";position:absolute;left:50%;top:45%;width:min(620px,150%);aspect-ratio:1;translate:-50% -50%;pointer-events:none;opacity:.35;
background:repeating-conic-gradient(from 0deg,var(--mythic) 0 6deg,#0000 6deg 15deg,#f2b33d 15deg 19deg,#0000 19deg 30deg);mask:radial-gradient(circle,#000 0,#000 22%,#0000 64%);-webkit-mask:radial-gradient(circle,#000 0,#000 22%,#0000 64%);animation:rays 40s steps(120) infinite}
@keyframes rays{to{rotate:1turn}}
.cf.big{width:min(320px,100%);--cs:12px;padding:var(--s2) var(--s3) var(--s4);gap:var(--s1);filter:drop-shadow(0 16px 0 #0005);transform-style:preserve-3d;will-change:transform}
@media (max-width:420px){.cf.big{--cs:10px}}
.cf.big .cf-art{padding:var(--s3) 0 var(--s2);border-bottom-width:6px}
.cf.big .poke{padding:0;border:0;background:none;cursor:pointer;display:block}
.cf.big .poke .spr,.cf.big .nojs .spr{width:calc(16 * var(--cs));height:calc(16 * var(--cs))}
html.js .cf.big .nojs{display:none}
.cf.big .cf-name{font-size:1.5rem;margin-top:var(--s3)}
.cf.big .cf-rar{font-size:1rem}
.cf.big .cf-kind{font-size:.9375rem}
.cf.big .cf-row{font-size:.875rem}
.cf-dna{display:flex;gap:6px;margin:var(--s1) 0}
.cf-dna i{width:18px;height:18px;background:var(--c);box-shadow:inset 0 0 0 2px #1d172633}
.cf.big.foil .holo,.cf.big.shiny .holo{opacity:.18}
.cf.big.tilting .holo{opacity:.5}
.cf.big.foil:not(.tilting) .holo{animation:holo 2.4s linear infinite}
.cf.big.shiny .holo{background:linear-gradient(115deg,transparent calc(var(--hx,50%) - 14%),#fff6c9 calc(var(--hx,50%) - 4%),#f2b33d var(--hx,50%),#fff6c9 calc(var(--hx,50%) + 4%),transparent calc(var(--hx,50%) + 14%))}
.plaque{position:relative;padding:var(--s4);background:#5a3c2a;color:#fbf1e2;box-shadow:inset 0 0 0 4px #3b2a22,inset 0 -8px 0 #3b2a22;
clip-path:polygon(0 8px,8px 8px,8px 0,calc(100% - 8px) 0,calc(100% - 8px) 8px,100% 8px,100% calc(100% - 8px),calc(100% - 8px) calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,8px calc(100% - 8px),0 calc(100% - 8px))}
.plaque h1{font-size:clamp(2rem,1.5rem + 2vw,2.75rem);font-weight:800;line-height:1.15;overflow-wrap:anywhere;--hsh:#1f1410;--sho:.8}
.plaque h1 .pt{--gp:3px}
@media (min-width:768px){.plaque h1 .pt{--gp:4px}}
.story{list-style:none;padding:0;margin:var(--s3) 0 0;display:flex;flex-wrap:wrap;gap:var(--s2);font-size:.9375rem}
.story li{padding:3px 10px 4px;background:#3b2a22;color:#f1e3cf}
.story li.seal{background:#a8324a;color:#fbf1e2;box-shadow:inset 0 -3px 0 #7a2236}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2);margin:var(--s4) 0 0}
.stats div{padding:10px var(--s2) 12px;background:#3b2a22;text-align:center}
.stats dt{font-size:.8125rem;color:#e6d3bd}
.stats dd{margin:0;font:800 1.375rem/1.2 var(--sans);font-variant-numeric:tabular-nums}
.traits{list-style:none;padding:0;margin:var(--s4) 0 0}
.traits li+li{margin-top:var(--s2)}
.traits span{color:#e6d3bd}
`
