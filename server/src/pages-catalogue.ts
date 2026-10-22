// Public field-guide pages. Season creatures use this world's frozen forms; Mythics use surviving
// public cards. An unfound species stays a silhouette and a missing Mythic never gets invented art.
import { FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { SPECIES_ID } from '../../plugin/hooks/core/species.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { CardStage, Family, Species } from '../../plugin/hooks/core/types.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import { FAMILY_COLOR, FAMILY_MARK } from '../../plugin/hooks/ui/tokens.ts'
import type { Api, Ctx } from './app.ts'
import { CARD_HELP, STAT_KEYS } from './card-guide.ts'
import { ensureSeason } from './game/ctx.ts'
import {
  cardHelp, cardTiles, discoveryCredit, heading, html, layout, notice, PLACE, PLACE_CSS, raw, text,
} from './pages-html.ts'
import type { DiscoveryCredits, Raw } from './pages-html.ts'
import { LANTERN_SYMBOL, mythicLantern } from './pages-lantern.ts'
import { placeStripSvg } from './pages-scene.ts'
import { shadowSvg, spriteSvg } from './pages-sprite.ts'
import { publicMythics, speciesCredit } from './public-collection.ts'

const CACHE = 'no-store'

export function registerCatalogue(api: Api): void {
  api.add({
    method: 'GET', path: '/species/:id', public: true, limit: 'browse',
    handler: async ctx => {
      const match = SPECIES_ID.exec(ctx.params.id!)
      if (!match || Number(match[1]) > seasonOf(ctx.now)) return missing(ctx)
      const { species } = await ensureSeason(ctx.db, Number(match[1]))
      const form = species.find(s => s.id === ctx.params.id)
      if (!form) return missing(ctx)
      const credit = await speciesCredit(ctx.db, form.id)
      const name = credit ? text(form.names[form.legendary ? 2 : 0], 48) : 'Not yet discovered'
      return layout({
        kind: 'site', title: `${name}: Spinlings catalogue`, description: credit
          ? `${name}, a ${FAMILY_INFO[form.family].name} species from Spinlings season ${form.season}. Its forms, base stats, special and first discoverer.`
          : `An undiscovered ${FAMILY_INFO[form.family].name} species from Spinlings season ${form.season}.`,
        path: `/species/${form.id}`, origin: ctx.origin, noindex: true, cache: CACHE, now: ctx.now, css: CATALOGUE_CSS,
        body: html`${placeStrip(form.family)}<section class="wrap catalogue">
${catalogueNav('species')}
<p class="catalogue-kicker">Season ${form.season} · <span class="mark" style="color:${FAMILY_COLOR[form.family]}" aria-hidden="true">${FAMILY_MARK[form.family]}</span> ${FAMILY_INFO[form.family].name}${form.legendary ? ' · Legendary' : ''}</p>
<h1>${heading(name)}</h1>
${credit ? html`${discoveryCredit({ ...credit, kind: 'species' })}
<p class="catalogue-intro">${form.legendary ? 'This legendary is always in its final form.' : 'One species, three forms. Every individual card has its own colours, genes and traits.'}</p>
<ol class="evolutions" aria-label="Evolution forms">${(form.legendary ? [3] : [1, 2, 3]).map(stage => evolution(form, stage as CardStage))}</ol>
<div class="species-guide"><section><h2>${heading('Base stats')}</h2>
<p class="soft">${form.legendary ? 'The species baseline, before its final-form and card bonuses.' : 'Stage 1, level 1 and common rarity, before genes.'} Rarity, level, evolution, genes and traits change an individual card’s final stats. These are the species values, not one player’s card.</p>
<dl class="species-stats">${STAT_KEYS.map(k => html`<div><dt>${cardHelp(CARD_HELP.stats[k].label, CARD_HELP.stats[k].text)}</dt><dd>${form.base[k]}</dd></div>`)}</dl>
</section><section><h2>${heading('In battle')}</h2>
${cardHelp(`${FAMILY_INFO[form.family].name} matchups`, CARD_HELP.families[form.family].text)}
${cardHelp(CARD_HELP.families[form.family].special.name, CARD_HELP.families[form.family].special.text)}
${cardHelp('How damage works', CARD_HELP.damage)}
</section></div>` : html`<div class="undiscovered"><span class="unknown-art">${raw(shadowSvg(spriteFor({ form, stage: form.legendary ? 3 : 1 })))}</span><p>Nobody has found this species yet. Its name, colours and details appear after the first discovery.</p></div>`}
<nav class="species-neighbours" aria-label="Other species">${speciesNeighbours(species, form)}</nav>
</section>`,
      })
    },
  })

  api.add({
    method: 'GET', path: '/mythics', public: true, limit: 'browse',
    handler: async ctx => {
      const shelf = await publicMythics(ctx.db, ctx.now, ctx.url.searchParams)
      return layout({
        kind: 'site', title: 'Mythics: Spinlings catalogue', description: 'The one-of-a-kind Mythics caught by Spinlings trainers, with their real cards and discovery credits.',
        path: '/mythics', origin: ctx.origin, noindex: true, cache: CACHE, now: ctx.now, css: CATALOGUE_CSS,
        body: html`${raw(LANTERN_SYMBOL)}<section class="wrap catalogue mythic-catalogue">
${catalogueNav('mythics')}
<p class="catalogue-kicker">One of a kind</p><h1>${heading('Mythics')}</h1>
<p class="catalogue-intro">A lantern for every Mythic found. Each creature exists once in the whole world.</p>
<p class="catalogue-count">${shelf.total} ${shelf.total === 1 ? 'Mythic' : 'Mythics'} found</p>
${shelf.mythics.length ? html`<ul class="mythic-shelf">${shelf.mythics.map(m => {
          const credit = { kind: 'mythic' as const, handle: m.handle }
          if (!m.card) return html`<li class="mythic-history">${raw(mythicLantern())}<div class="mythic-memory"><h2>${text(m.name, 48)}</h2><p class="soft">The original card is no longer available.</p>${discoveryCredit(credit)}</div></li>`
          const credits: DiscoveryCredits = new Map([[m.card.id, credit]])
          return html`<li>${raw(mythicLantern())}${cardTiles([m.card], { link: true, credits })}</li>`
        })}</ul>` : html`<div class="catalogue-empty">${raw(mythicLantern(false))}<p>No caught Mythics here yet. The first one will light a lantern.</p></div>`}
<nav class="catalogue-pages" aria-label="Mythic pages">${ctx.url.searchParams.has('after') ? html`<a href="/mythics">Back to first page</a>` : ''}${shelf.next ? html`<a class="next" href="/mythics?after=${encodeURIComponent(shelf.next)}">More Mythics →</a>` : ''}</nav>
</section>`,
      })
    },
  })
}

function catalogueNav(active: 'species' | 'mythics'): Raw {
  return html`<nav class="catalogue-nav" aria-label="Catalogue"><a href="/#season"${active === 'species' ? html` aria-current="page"` : ''}>Season species</a><a href="/mythics"${active === 'mythics' ? html` aria-current="page"` : ''}>Mythics</a></nav>`
}

function evolution(s: Species, stage: CardStage): Raw {
  return html`<li class="evolution" style="--fam:${FAMILY_COLOR[s.family]};--psky:${PLACE[s.family][0]}"><div class="evolution-art">${raw(spriteSvg(spriteFor({ form: s, stage }), { label: text(s.names[stage - 1], 48), flash: false }))}</div><p class="evolution-step">${s.legendary ? 'Final form' : `Stage ${stage} of 3`}</p><h2>${heading(text(s.names[stage - 1], 48))}</h2></li>`
}

function speciesNeighbours(all: readonly Species[], s: Species): Raw {
  const sameFamily = all.filter(next => next.family === s.family), index = sameFamily.findIndex(next => next.id === s.id)
  return html`${index > 0 ? html`<a href="/species/${sameFamily[index - 1]!.id}">← Previous species</a>` : ''}<a href="/#season">Back to the catalogue</a>${index < sameFamily.length - 1 ? html`<a href="/species/${sameFamily[index + 1]!.id}">Next species →</a>` : ''}`
}

function placeStrip(family: Family): Raw {
  const [sky, ground, shade] = PLACE[family]
  return html`<div class="place" style="--psky:${sky};--pground:${ground};--pshade:${shade}" aria-hidden="true">${raw(placeStripSvg())}</div>`
}

function missing(ctx: Ctx): Response {
  return notice({
    title: 'No such species: Spinlings', heading: 'Nothing in this patch of grass.', path: ctx.url.pathname,
    origin: ctx.origin, status: 404, cache: CACHE, now: ctx.now,
    lines: ['That creature is not in the catalogue.'], extra: html`<p><a href="/#season">Back to the catalogue</a></p>`,
  })
}

export const CATALOGUE_CSS = PLACE_CSS + `
main{display:block;background:#1c1a26;color:#f4f2fb;padding-bottom:var(--s6)}
main .soft{color:#c9c3d6}main :focus-visible{outline-color:#fffdf5}
.place{margin-bottom:var(--s4)}
.place .placeart{left:50%;transform:translateX(-50%);width:calc(480 * var(--ap));height:calc(64 * var(--ap))}
.catalogue{overflow-wrap:anywhere}.catalogue h1{font-size:clamp(2rem,1.4rem + 2.4vw,3rem);font-weight:800;line-height:1.2}
.catalogue-nav,.species-neighbours,.catalogue-pages{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);align-items:center}
.catalogue-nav{margin-bottom:var(--s4)}.catalogue-nav a{padding:8px 0;font-weight:700;min-height:44px}
.catalogue-nav [aria-current]{color:#ffe2a0;text-decoration-thickness:3px;text-underline-offset:6px}
.catalogue-kicker{margin-bottom:var(--s2);color:#c9c3d6;font-size:.875rem;font-weight:700}
.catalogue-intro{max-width:64ch;margin-top:var(--s3);color:#e2deee;font-size:1.125rem}.catalogue-count{margin-top:var(--s3);font-weight:700}
.evolutions{list-style:none;margin:var(--s4) 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3)}
.evolutions:has(>.evolution:only-child){grid-template-columns:minmax(0,320px)}
.evolution{min-width:0;padding:var(--s3);background:#2b2430;border-top:4px solid var(--fam);box-shadow:inset 0 -4px 0 #110e18}
.evolution-art{display:grid;place-items:end center;min-height:176px;background:var(--psky);box-shadow:inset 0 -12px 0 #0003;padding:var(--s3)}
.evolution-art .spr{width:128px;height:128px;max-width:100%}.evolution-step{margin-top:var(--s3);font-size:.8125rem;color:#c9c3d6}
.evolution h2{margin-top:var(--s1);font-size:1.125rem;font-weight:800}.evolution h2 .pt{--gp:2px}
.species-guide{margin-top:var(--s5);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--s4)}
.species-guide h2{font-size:1.5rem;font-weight:800;margin-bottom:var(--s3)}.species-guide .soft{font-size:.9375rem}
.species-guide .card-help{margin-top:var(--s2)}.species-guide .help-body{color:#c9c3d6}
.species-stats{position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2);margin-top:var(--s3)}
.species-stats>div{padding:var(--s2);background:#302938;min-width:0}.species-stats dt{font-size:.8125rem}.species-stats .card-help{margin:0}.species-stats summary{min-height:32px}
.species-stats .card-help,.species-stats .card-help>summary{position:static}.species-stats .help-peek{left:0;right:0;width:100%;max-width:100%}
.species-stats dd{font-size:1.375rem;font-weight:800;margin:0;font-variant-numeric:tabular-nums}
.undiscovered{display:flex;align-items:center;gap:var(--s4);max-width:640px;padding:var(--s4);margin-top:var(--s4);background:#26222f}
.unknown-art{display:grid;place-items:center;flex:none;background:#191520;width:144px;height:160px;color:#73657d}.unknown-art .shd{width:112px;height:112px}
.species-neighbours,.catalogue-pages{margin-top:var(--s5)}.species-neighbours a,.catalogue-pages a{display:inline-flex;align-items:center;min-height:44px}.catalogue-pages .next{margin-left:auto}
main:has(.mythic-catalogue){background:#142039}.mythic-catalogue{padding-top:var(--s5)}
.mythic-catalogue .catalogue-kicker,.mythic-catalogue .catalogue-count{color:#ffe2a0}.mythic-catalogue .catalogue-intro,.mythic-catalogue .soft{color:#b7c0d8}
.mythic-shelf{list-style:none;margin:var(--s5) 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:var(--s5) var(--s4)}
.mythic-shelf>li{min-width:0;position:relative}.mythic-shelf .cards{list-style:none;margin:0;padding:0;display:grid}.mythic-shelf .cardlink{display:block;color:inherit;text-decoration:none}.mythic-shelf .cf{width:100%}
.mythic-lamp{--lg:#ffcf6a;--lb:#ffe9a8;--lt:#f2b33d;position:relative;display:block;height:88px;border-top:2px solid #0a0f20}
.mythic-lamp::before{content:"";position:absolute;width:2px;height:12px;background:#3b2a22;top:0;left:calc(50% - 1px)}
.mythic-lamp svg{position:relative;display:block;width:65px;height:80px;margin:4px auto 0;overflow:visible}.mythic-lamp .lglow{fill:#ffcf6a;opacity:.16}
.mythic-lamp.unlit{--lg:#26304b;--lb:#2c3552;--lt:#3a4058}
.mythic-shelf .cardlink{box-shadow:0 -4px 0 #ffe2a026}.mythic-shelf .card-discovery a{color:#ffe9a8}
.mythic-memory{padding:var(--s4);background:#1c2941;border-top:4px solid #ffe2a04d;min-height:240px}.mythic-history h2{font-size:1.125rem;font-weight:800}.mythic-history p{margin-top:var(--s2)}
.catalogue-empty{max-width:360px;margin-top:var(--s5);text-align:center}.catalogue-empty p{margin-top:var(--s3);color:#b7c0d8}
@media(max-width:700px){.species-guide{grid-template-columns:1fr}.evolutions{grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s2)}.evolution{padding:var(--s2)}.evolution-art{min-height:120px;padding:var(--s2)}.evolution-art .spr{width:80px;height:80px}.evolution h2 .pt{--gp:1.5px}}
@media(max-width:479px){.evolutions{grid-template-columns:1fr}.evolution{display:grid;grid-template-columns:96px minmax(0,1fr);gap:0 var(--s3);align-items:center}.evolution-art{grid-row:1/3;min-height:104px}.evolution-step{align-self:end;margin-top:0}.evolution h2{align-self:start;margin-top:var(--s1)}.evolution h2 .pt{--gp:2px}.species-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.undiscovered{flex-direction:column;align-items:flex-start;padding:var(--s3)}}
`
