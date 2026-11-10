// The reveal ceremonies (SPEC 13.5, 13.9, 13.10, 14, 25): the pack (a package that tears open, glowing backs that flip
// one by one, layered reveals, a summary), the present, the fusion or drop egg, a craft and a bounty. The view draws
// each state; the driver paces the states and, on the terminal, blits the frames in between (build-up, pause, flash,
// celebration). On the desktop each state is one SMIL Svg that plays the same beats. Everything auto-advances; with
// motion off every card is face up at once. The last reveal stays to re-read until Done.
import type { RenderElement } from 'claude-code'
import type { Card } from '../core/types.ts'
import { geneScore, look } from '../core/cards.ts'
import { FAMILY_INFO } from '../core/families.ts'
import { TRAITS } from '../core/traits.ts'
import type { Fx, Reveal, RevealControl, RevealDriver } from '../client/types.ts'
import { bar, dots, fit, plural } from '../client/text.ts'
import { bulkReady, bulkSummary, rarityGroups, topPull, turns } from '../client/bulk.ts'
import { packsLine, perRow, revealLine, revealSummary, revealTitle } from '../client/viewmodels.ts'
import { artPixels, artSvg, card, displayName, frameOf, isMythic, rarityColor, rarityLabel, stamps } from './card.tsx'
import type { CardFace } from './card.tsx'
import { TIMING, tint } from '../client/anim.ts'
import type { Cells } from './ceremony-art.tsx'
import {
  backStage, eggStage, faceStage, flipStage, mergeStage, packStage, presentStage, singleMs, slotCells, spinStage, stackLayers,
  stackStage, stageCells, svgFace, svgGenes, svgPackage, svgProgress, svgSingle, svgSlotBack, svgStack, svgTurn,
} from './ceremony-art.tsx'
import type { Ctx, Shown } from './pane-kit.tsx'
import { CHIP, TILE, actions, btn, cardRow, chip, column, grid, line, para, tile } from './pane-kit.tsx'
import { FAMILY_COLOR, FAMILY_MARK, INK, MARK, MYTHIC_COLOR, RARITY_COLOR, SPACE, SVG_SCALE, hexInt } from './tokens.ts'

const STAGE_SCALE = 8
const SINGLE = new Set<Reveal['kind']>(['egg', 'present', 'bounty', 'craft'])
type SingleKind = 'egg' | 'present' | 'bounty' | 'craft'

const isSingle = (r: Reveal) => r.cards.length === 1 && SINGLE.has(r.kind)
const isFusion = (c: Card) => c.species === 'fusion'

const TRINKET: Record<string, string> = { hat: 'wears a tiny hat', bow: 'wears a bow', flower: 'wears a flower', scarf: 'wears a scarf', monocle: 'wears a gold monocle' }

function trinketOf(c: Card): string {
  try {
    return TRINKET[look(c).trinket] ?? ''
  } catch {
    return ''
  }
}

/** How many extra beats a card earns: NEW, first in the world, foil, shiny, high genes, a trinket (SPEC 14). */
export function layers(c: Card, r: Reveal): number {
  return [r.fresh.includes(c.species), !!c.firstFind, !!c.foil, c.shiny, geneScore(c.genes) >= 80, trinketOf(c) !== ''].filter(Boolean).length
}

/** How long a turned card holds the stage, celebrating, before the next one builds up. */
export const holdMs = (c: Card, r: Reveal) => TIMING.hold[c.rarity] + layers(c, r) * TIMING.layer

/** What turns one by one: a bulk opening's best pulls, or every card of any other reveal. */
const turning = (r: Reveal): Reveal => (r.bulk ? { ...r, cards: r.cards.slice(0, turns(r)) } : r)

/** A pack before its tear has played: the package alone, the strip of backs not out yet. */
const sealedPack = (r: Reveal, i: number) => r.kind === 'pack' && i === 0 && !r.torn

// ---------- what the stage shows at rest, per state ----------

/** The stage's resting picture: the wrapper before anything flips, then the last card turned face up. */
export function stillStage(r: Reveal, i: number): Cells {
  const c = r.cards[Math.max(0, Math.min(r.cards.length - 1, i - 1))]
  if (i >= 1 && c) return stageCells(artPixels(c), frameOf(c))
  const first = r.cards[0]
  if (r.bulk && first) return backStage(first, 0)
  if (r.kind === 'pack' && r.family) return packStage(r.family, r.torn ? 3 : 0)
  if (!first) return packStage(r.family ?? 'sonnet', 3)
  if (isSingle(r) && r.kind === 'present') return presentStage(0)
  if (isSingle(r) && r.kind === 'egg') return eggStage(first, 0, 0)
  return backStage(first, 0)
}

/** The desktop's state: the same beats the driver plays on the terminal, from the last turned card to the next flip. */
function stageSvg(c: Ctx, r: Reveal, i: number): string {
  const first = r.cards[0]
  if (sealedPack(r, i) && r.family) return svgPackage(r.family, STAGE_SCALE, c.motion && !r.packId)
  if (!first) return svgPackage(r.family ?? 'sonnet', STAGE_SCALE, false)
  if (isSingle(r)) return svgSingle(r.kind as SingleKind, first, STAGE_SCALE, c.motion, isFusion(first))
  const prev = i >= 1 ? r.cards[i - 1]! : null
  const next = r.cards[i]
  if (!next) return svgFace(prev ?? first, STAGE_SCALE)
  return svgTurn(next, STAGE_SCALE, c.motion, prev ? { card: prev, hold: holdMs(prev, r) } : null)
}

function stage(c: Ctx, r: Reveal, i: number): RenderElement {
  if (c.surface === 'terminal') {
    const s = stillStage(r, i)
    return <c.el.Raster key="cer-stage" columns={s.columns} rows={s.rows} cells={s.cells} />
  }
  const side = 18 * STAGE_SCALE
  const alt = i >= 1 ? `${displayName(r.cards[i - 1]!)}, ${rarityLabel(r.cards[i - 1]!)}` : revealTitle(r)
  return <c.el.Svg source={stageSvg(c, r, i)} alt={alt} width={side} height={side} isInteractive={c.motion && !r.packId} />
}

function slot(c: Ctx, card: CardFace, up: boolean, k: number): RenderElement {
  if (c.surface === 'terminal') {
    const s = slotCells(card, up)
    return <c.el.Raster key={`cer-slot-${k}`} columns={s.columns} rows={s.rows} cells={s.cells} />
  }
  const side = 8 * SVG_SCALE.mini
  const source = up ? artSvg(artPixels(card, true), null, SVG_SCALE.mini, false) : svgSlotBack(card, SVG_SCALE.mini, c.motion)
  return <c.el.Svg source={source} alt={up ? displayName(card) : 'a card face down'} width={side} height={side} isInteractive={c.motion && !up} />
}

/**
 * The strip of the whole pack: faces for what is turned, glowing backs for what waits (one glowing gold, say). Below
 * the strip's width it wraps onto a second row rather than overflowing.
 */
function strip(c: Ctx, r: Reveal, i: number): RenderElement {
  return <c.el.Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.tight} width={c.columns}>{...r.cards.map((x, k) => slot(c, x, k < i, k))}</c.el.Box>
}

/** The last revealed card's layers, one per line: name, rarity and badges, family and level, genes, traits, trinket. */
function info(c: Ctx, r: Reveal, x: Card, width: number): RenderElement {
  const { Box, Text, Svg } = c.el
  const genes = geneScore(x.genes)
  const traits = x.traits.map(t => (TRAITS as Record<string, { name: string } | undefined>)[t]?.name ?? t).join(', ')
  const badges = dots(r.fresh.includes(x.species) && 'NEW', x.firstFind && '★ FIRST IN THE WORLD')
  const marks = stamps(x, { offline: c.offline }).filter(s => !s.includes('First Discovered'))
  const trinket = trinketOf(x)
  return (
    <Box flexDirection="column" width={width}>
      <Text bold color={rarityColor(x)} wrap="truncate-end">{fit(displayName(x, 32), width)}</Text>
      <Text wrap="truncate-end" color={rarityColor(x)}>{fit(rarityLabel(x), width)}</Text>
      {badges ? <Text wrap="truncate-end" color={INK.accent}>{fit(badges, width)}</Text> : null}
      <Text wrap="truncate-end">
        <Text color={FAMILY_COLOR[x.family]}>{FAMILY_MARK[x.family]}</Text>
        <Text>{fit(` ${FAMILY_INFO[x.family].name} · Lv ${x.level}`, width - 1)}</Text>
      </Text>
      {c.surface === 'terminal'
        ? <Text wrap="truncate-end"><Text dimColor>Genes </Text><Text {...(genes >= 80 ? { color: RARITY_COLOR.legendary } : {})}>{bar(genes / 100, 8)}</Text><Text>{` ${genes}%`}</Text></Text>
        : (
          <Box flexDirection="row" columnGap={SPACE.tight}>
            <Text dimColor>Genes</Text>
            <Svg source={svgGenes(genes, c.motion)} alt={`gene score ${genes}%`} width={96} height={8} isInteractive={c.motion} />
            <Text>{`${genes}%`}</Text>
          </Box>
        )}
      {traits ? <Text wrap="truncate-end" dimColor>{fit(traits, width)}</Text> : null}
      {trinket ? <Text wrap="truncate-end" color={INK.accent}>{fit(trinket, width)}</Text> : null}
      {marks.length > 0 ? <Text wrap="truncate-end" color={INK.accent}>{fit(marks.join(' · '), width)}</Text> : null}
    </Box>
  )
}

/** The words beside the stage before anything is turned. */
function waiting(c: Ctx, r: Reveal, width: number): RenderElement {
  const { Box, Text } = c.el
  const n = r.cards.length
  const first = r.cards[0]
  const lead = r.kind === 'pack' ? `${plural(n, 'card')} inside`
    : r.kind === 'present' ? 'Something is wrapped up for you'
    : r.kind === 'egg' ? (first && isFusion(first) ? 'Two creatures become one' : 'Something stirs inside')
    : r.kind === 'bounty' ? 'Spinning out of their corner'
    : `${plural(n, 'card')} face down`
  const glowing = r.cards.filter(x => x.rarity !== 'common' || isMythic(x)).length
  const b = r.bulk
  return (
    <Box flexDirection="column" width={width}>
      <Text bold wrap="truncate-end">{fit(b ? `${plural(b.opened, 'pack')} open` : revealTitle(r), width)}</Text>
      <Text wrap="truncate-end">{fit(b ? (n === 1 ? 'Your best pull' : `Your best ${n}, the top one last`) : lead, width)}</Text>
      {n > 1 && glowing > 0 ? <Text dimColor wrap="truncate-end">{fit(`${plural(glowing, 'back')} glowing`, width)}</Text> : null}
    </Box>
  )
}

// ---------- the screens ----------

/** The ceremony body, framed by a round border that turns gold for a legendary (SPEC 13.5). */
export function ceremonyScreen(c: Ctx, r: Reveal): Shown {
  if (r.packId) return {
    body: column(c, [
      line(c, revealTitle(r), { bold: true }),
      stage(c, r, 0),
      para(c, 'Ready when you are.', { dim: true }),
      actions(c, [
        btn(c, { key: 'flip', label: 'Open', hotkey: 'o', primary: true, on: () => c.actions.flip(r.id) }),
        btn(c, { key: 'done', label: 'Close', hotkey: 'd', on: () => c.actions.doneReveal(r.id) }),
      ]),
    ]),
    hints: ['o Open', 'esc Close'],
  }
  const i = Math.max(0, c.state.pane.flipped)
  const n = r.cards.length
  const inner: Ctx = { ...c, columns: c.columns - 2 }
  const shown = turning(r)
  const done = bulkReady(r) && (i >= n || (isSingle(r) && i >= 1) || (!!r.bulk && shown.cards.length === 0))
  // a bulk summary keeps the gold border of its top pull; elsewhere the border follows the card just turned
  const last = r.bulk && done ? topPull(r) : i >= 1 ? shown.cards[Math.min(shown.cards.length, i) - 1] : undefined
  const legendary = !!last && (last.rarity === 'legendary' || isMythic(last))
  const borderColor = legendary ? (last && isMythic(last) ? MYTHIC_COLOR : RARITY_COLOR.legendary) : INK.muted
  const body = !bulkReady(r) ? opening(inner, r) : done ? (r.bulk ? bulkScreen(inner, r) : summary(inner, r)) : flipping(inner, shown, i, legendary)
  return {
    body: <c.el.Box flexDirection="column" width={c.columns} borderStyle="round" borderColor={borderColor} borderDimColor={!legendary}>{body.body}</c.el.Box>,
    hints: body.hints,
  }
}

function flipping(c: Ctx, r: Reveal, i: number, legendary: boolean): Shown {
  const { Box, Text } = c.el
  const n = r.cards.length
  const wide = c.columns >= 18 + SPACE.loose + 26
  const width = wide ? c.columns - 18 - SPACE.loose : c.columns
  const sealed = i === 0 && (sealedPack(r, i) || isSingle(r))
  const last = i >= 1 ? r.cards[i - 1]! : null
  const words = last ? info(c, r, last, width) : waiting(c, r, width)
  const banner = legendary && last ? line(c, isMythic(last) ? 'MYTHIC!' : 'LEGENDARY!', { color: isMythic(last) ? MYTHIC_COLOR : RARITY_COLOR.legendary, bold: true }) : null
  const flipLabel = r.bulk && i >= n ? 'See them all' : 'Flip next'
  const go = sealed
    ? btn(c, { key: 'flip', label: 'Open', hotkey: 'o', primary: true, on: () => c.actions.flip(r.id) })
    : btn(c, { key: 'flip', label: flipLabel, hotkey: 'f', on: () => c.actions.flip(r.id) })
  const skip = r.bulk && i < n ? btn(c, { key: 'skip', label: 'Skip to all', hotkey: 's', on: () => c.actions.skip(r.id) }) : null
  return {
    body: column(c, [
      banner,
      n > 1 && !sealedPack(r, i) ? strip(c, r, i) : null,
      <Box flexDirection={wide ? 'row' : 'column'} columnGap={SPACE.loose} rowGap={SPACE.tight}>
        <Box flexShrink={0}>{stage(c, r, i)}</Box>
        {words}
      </Box>,
      <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose}>
        {go}
        {skip}
        <Text dimColor>{n > 1 && i > 0 ? `${Math.min(i, n)} of ${n}${r.bulk ? ' best' : ''}` : ''}</Text>
      </Box>,
    ]),
    hints: [sealed ? 'o Open' : `f ${flipLabel}`, skip ? 's Skip to all' : '', 'it opens by itself too', 'esc Done'],
  }
}

function summary(c: Ctx, r: Reveal): Shown {
  const n = r.cards.length
  if (n === 1 && isSingle(r)) {
    const x = r.cards[0]!
    return {
      body: column(c, [
        line(c, revealLine(r, x), { bold: true }),
        r.fresh.includes(x.species) ? line(c, 'NEW species for your album', { color: INK.accent }) : null,
        card(c.el, c.surface, x, 'full', { key: 'cer-card', width: c.columns, motion: c.motion, offline: c.offline, now: c.now }),
        actions(c, [
          btn(c, { key: 'share', label: 'Share', hotkey: 's', on: () => c.actions.share(x.id) }),
          btn(c, { key: 'done', label: 'Done', hotkey: 'd', on: () => c.actions.doneReveal(r.id) }),
        ]),
      ]),
      hints: ['s Share', 'd Done', 'esc Done'],
    }
  }
  const words = revealSummary(r) || packsLine(r.packs) || 'Nothing inside this time.'
  const per = perRow(c.columns, TILE)
  const shown = per >= 3
    ? grid(c, r.cards.map((x, k) => tile(c, x, { key: `sum-${k}`, ...(r.fresh.includes(x.species) ? { note: 'NEW' } : {}), on: () => c.actions.push({ kind: 'card', cardId: x.id }) })), per)
    : column(c, r.cards.map((x, k) => cardRow(c, x, { key: `sum-${k}`, note: dots(rarityLabel(x), r.fresh.includes(x.species) && 'NEW'), on: () => c.actions.push({ kind: 'card', cardId: x.id }) })), SPACE.none)
  const team = n > 0 && (r.kind === 'pack' || r.kind === 'trader' || r.kind === 'redeem')
  return {
    body: column(c, [
      line(c, words, { bold: true }),
      n > 0 ? shown : null,
      actions(c, [
        team && !c.state.pane.busy && !c.state.account.readOnly ? btn(c, { key: 'set-team', label: n === 1 ? 'Set in team' : 'Choose cards', hotkey: 't', on: async () => {
          if (n === 1) await c.actions.push({ kind: 'team-slot', cardId: r.cards[0]!.id })
          else {
            await c.actions.doneReveal(r.id)
            await c.actions.tab('cards')
          }
        } }) : null,
        btn(c, { key: 'done', label: 'Done', hotkey: 'd', on: () => c.actions.doneReveal(r.id) }),
      ]),
      team ? para(c, n === 1 ? 'Choose where this creature joins your team.' : 'Pick each card and choose its team slot.', { dim: true }) : null,
    ]),
    hints: [team ? n === 1 ? 't Set in team' : 't Choose cards' : '', 'd Done', 'Tab Look at a card'],
  }
}

// ---------- every pack at once ----------

/** The packs still waiting, front first: the bank as it goes down, or the reveal's family once it is empty. */
function waitingFamilies(c: Ctx, r: Reveal): Card['family'][] {
  const left = (c.state.me?.packs ?? []).map(p => p.family)
  return left.length > 0 ? left.slice(0, 4) : [r.family ?? c.state.signals.family]
}

function stackArt(c: Ctx, families: readonly Card['family'][], layers: number, left: number): RenderElement {
  if (c.surface === 'terminal') {
    const s = stackStage(families, layers)
    return <c.el.Raster key="cer-stage" columns={s.columns} rows={s.rows} cells={s.cells} />
  }
  const side = 18 * STAGE_SCALE
  return <c.el.Svg source={svgStack(families, layers, STAGE_SCALE, c.motion)} alt={`${plural(left, 'pack')} still to open`} width={side} height={side} isInteractive={c.motion} />
}

/** While the packs open: the stack going down, how many are left, a bar, and what has turned up so far. */
function opening(c: Ctx, r: Reveal): Shown {
  const { Box, Text, Svg } = c.el
  const b = r.bulk!
  const left = Math.max(0, b.packs - b.opened)
  const families = waitingFamilies(c, r)
  const layers = stackLayers(left, b.packs)
  const wide = c.columns >= 18 + SPACE.loose + 20
  const width = wide ? c.columns - 18 - SPACE.loose : c.columns
  const color = FAMILY_COLOR[families[0] ?? 'sonnet']
  const share = b.opened / Math.max(1, b.packs)
  const found = (['legendary', 'epic', 'rare'] as const).map(rarity => [rarity, r.cards.filter(x => x.rarity === rarity).length] as const).filter(([, count]) => count > 0)
  const words = (
    <Box flexDirection="column" width={width}>
      <Text bold wrap="truncate-end">{fit(`Opening ${plural(b.packs, 'pack')}`, width)}</Text>
      <Text wrap="truncate-end" dimColor={!!b.stopping}>{fit(b.stopping ? 'Stopping' : left > 0 ? `${left} to go` : 'All open', width)}</Text>
      {c.surface === 'terminal'
        ? <Text wrap="truncate-end"><Text color={color}>{bar(share, Math.max(4, Math.min(16, width - 6)))}</Text><Text dimColor>{` ${b.opened}/${b.packs}`}</Text></Text>
        : <Box flexDirection="row" columnGap={SPACE.tight}>
          <Svg source={svgProgress(share, color)} alt={`${b.opened} of ${b.packs} open`} width={96} height={8} />
          <Text dimColor>{`${b.opened}/${b.packs}`}</Text>
        </Box>}
      {found.length > 0
        ? <Text wrap="truncate-end">{...found.map(([rarity, count], j) => <Text color={RARITY_COLOR[rarity]}>{`${j > 0 ? ' · ' : ''}${count} ${rarity}`}</Text>)}</Text>
        : null}
    </Box>
  )
  return {
    body: column(c, [
      <Box flexDirection={wide ? 'row' : 'column'} columnGap={SPACE.loose} rowGap={SPACE.tight}>
        <Box flexShrink={0}>{stackArt(c, families, layers, left)}</Box>
        {words}
      </Box>,
      para(c, 'Claude keeps working while they open.', { dim: true }),
    ]),
    hints: [b.stopping ? '' : 'esc Stop'],
  }
}

/**
 * The summary of a bulk opening: what came out in one line and what to do next, then every card grouped by rarity,
 * rarest first, with a count per group, identical pulls stacked (`×3`) and NEW on species new to the album. New only
 * narrows it to those; each chip opens its card's page.
 */
function bulkScreen(c: Ctx, r: Reveal): Shown {
  const { Box, Text } = c.el
  const b = r.bulk!
  const fresh = new Set(r.fresh)
  const newOnly = !!b.newOnly && fresh.size > 0
  const cards = newOnly ? r.cards.filter(x => fresh.has(x.species)) : r.cards
  const per = perRow(c.columns, CHIP)
  const groups = rarityGroups(cards, fresh).map(g => (
    <Box key={`sum-${g.key}`} flexDirection="column" rowGap={SPACE.none} width={c.columns}>
      <Text color={g.key === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[g.key]}>{`${g.label} · ${g.count}`}</Text>
      {grid(c, g.stacks.map(({ card: x, count }) => {
        const note = dots(fresh.has(x.species) && 'NEW', count > 1 && `×${count}`)
        return chip(c, x, { key: `sum-${x.id}`, ...(note ? { note } : {}), on: () => c.actions.push({ kind: 'card', cardId: x.id }) })
      }), per)}
    </Box>
  ))
  const team = !c.state.pane.busy && !c.state.account.readOnly
  return {
    body: column(c, [
      line(c, bulkSummary(r), { bold: true }),
      actions(c, [
        btn(c, { key: 'done', label: 'Done', hotkey: 'd', on: () => c.actions.doneReveal(r.id) }),
        team ? btn(c, { key: 'set-team', label: 'Choose cards', hotkey: 't', on: async () => {
          await c.actions.doneReveal(r.id)
          await c.actions.tab('cards')
        } }) : null,
        fresh.size > 0
          ? btn(c, { key: 'new-only', label: `${newOnly ? `${MARK.check} ` : ''}New only · ${fresh.size}`, hotkey: 'n', dim: !newOnly, on: () => c.actions.newOnly(!newOnly) })
          : null,
      ]),
      column(c, groups, SPACE.tight),
    ], SPACE.loose),
    hints: ['d Done', team ? 't Choose cards' : '', fresh.size > 0 ? 'n New only' : '', 'Tab Look at a card'],
  }
}

// ---------- the driver ----------

/**
 * `state` is the state on show (cards turned, the tear), `refused` each key's refused blits in it: a Raster that is not
 * mounted (the desktop, a hidden pane, the strip before the tear) refuses, and the layout only changes with the state.
 */
type Run = { fx: Fx; ctl: RevealControl; id: string; state: string; refused: Map<string, number> }
type Frame = [key: string, cells: Cells]

/** Refusals after which a key is left alone until the state changes. */
const GIVE_UP = 8

const sleep = (fx: Fx, ms: number) => new Promise<void>(res => { fx.after(Math.max(0, ms), res) })

async function at(run: Run): Promise<{ r: Reveal; i: number } | null> {
  const r = await run.ctl.reveal()
  if (!r || r.id !== run.id) return null
  return { r, i: await run.ctl.flipped() }
}

/**
 * Plays `ms` of frames while the reveal stays at state `i`. False when the reveal closed or someone pressed on past
 * it. A key whose Raster keeps refusing is skipped for the rest of the state; the others still play.
 */
async function play(run: Run, i: number, ms: number, frames: ((t: number, s: number) => Frame[]) | null): Promise<boolean> {
  const start = await run.fx.now()
  for (;;) {
    const now = await at(run)
    if (!now || now.i !== i) return false
    const state = `${now.i}|${now.r.torn ? 1 : 0}`
    if (state !== run.state) {
      run.state = state
      run.refused.clear()
    }
    const el = (await run.fx.now()) - start
    if (frames) {
      for (const [key, cells] of frames(Math.min(1, el / Math.max(1, ms)), el / 1000)) {
        const refused = run.refused.get(key) ?? 0
        if (refused >= GIVE_UP) continue
        if (await run.fx.ui.blit('pane', key, cells.cells)) run.refused.delete(key)
        else run.refused.set(key, refused + 1)
      }
    }
    if (el >= ms) return true
    await sleep(run.fx, Math.min(TIMING.tick, ms - el))
  }
}

/** The face-down legendary and epic slots keep pulsing in the strip while you wait. */
function pulses(r: Reveal, i: number, s: number): Frame[] {
  const out: Frame[] = []
  r.cards.forEach((x, k) => {
    if (k >= i && (x.rarity === 'legendary' || x.rarity === 'epic' || isMythic(x))) out.push([`cer-slot-${k}`, slotCells(x, false, s)])
  })
  return out.slice(0, 3)
}

const face = (x: Card) => stageCells(artPixels(x), frameOf(x))
const BRIGHT = hexInt(INK.bright)

/** One frame of a single-card moment at `ms` into it, ending on the face. */
function singleFrame(kind: SingleKind, x: Card, ms: number): Cells {
  const fusion = isFusion(x)
  let t = ms
  if (kind === 'egg') {
    if (fusion) {
      if (t < TIMING.merge) return mergeStage(x, t / TIMING.merge)
      t -= TIMING.merge
    }
    if (t < 3 * TIMING.wobble) {
      const q = Math.floor((t % TIMING.wobble) / (TIMING.wobble / 4))
      return eggStage(x, 0, ([0, -1, 1, 0] as const)[q] ?? 0)
    }
    t -= 3 * TIMING.wobble
    if (t < TIMING.crack) return eggStage(x, 1, 0)
    t -= TIMING.crack
    if (t < TIMING.crack) return eggStage(x, 2, 0)
    t -= TIMING.crack
  } else if (kind === 'present') {
    if (t < 2 * TIMING.presentShake) return presentStage(0, ([0, 1, -1, 1] as const)[Math.floor(t / 110) % 4])
    t -= 2 * TIMING.presentShake
    if (t < TIMING.unwrap) return presentStage(1)
    t -= TIMING.unwrap
    if (t < TIMING.unwrap) return presentStage(2)
    t -= TIMING.unwrap
  } else if (kind === 'bounty') {
    if (t < TIMING.spin) return spinStage(x, t / TIMING.spin)
    t -= TIMING.spin
  } else {
    if (t < TIMING.buildup.rare) return backStage(x, t / 1000)
    t -= TIMING.buildup.rare
  }
  if (t < TIMING.cardFlash * 2) return stageCells(tint(artPixels(x), BRIGHT, 1 - t / (TIMING.cardFlash * 2)), frameOf(x))
  return face(x)
}

/** Paces the reveal (registered in register.tsx's REVEAL_DRIVER slot). Resolves when the reveal is done or gone. */
export const ceremony: RevealDriver = async (fx, ctl) => {
  const first = await ctl.reveal()
  if (!first) return
  const run: Run = { fx, ctl, id: first.id, state: '', refused: new Map() }
  let tore = false
  for (;;) {
    const now = await at(run)
    if (!now) return
    const { i } = now
    // a bulk opening plays its best pulls, then turns the rest at once into the summary
    const r = turning(now.r)
    const n = r.cards.length
    if (i >= now.r.cards.length || !bulkReady(now.r)) return
    if (i >= n || !(await ctl.motion())) {
      await ctl.flip(now.r.cards.length)
      return
    }
    if (isSingle(r)) {
      const x = r.cards[0]!
      const kind = r.kind as SingleKind
      if (!(await play(run, 0, singleMs(kind, isFusion(x)), (_, s) => [['cer-stage', singleFrame(kind, x, s * 1000)]]))) continue
      await ctl.flip(1)
      await play(run, 1, TIMING.hold[x.rarity], (_, s) => [['cer-card-art', faceStage(x, s)]])
      return
    }
    // the package waits a beat and tears; only then do the five backs come out (the strip, a state of its own)
    if (sealedPack(r, i) && r.family && !tore) {
      const family = r.family
      if (!(await play(run, 0, TIMING.tearDelay, null))) continue
      if (!(await play(run, 0, TIMING.tear, t => [['cer-stage', packStage(family, Math.min(3, 1 + Math.floor(t * 3)) as 1 | 2 | 3)]]))) continue
      tore = true
      await ctl.tear()
      continue
    }
    const x = r.cards[i]!
    if (!(await play(run, i, TIMING.buildup[x.rarity], (_, s) => [['cer-stage', backStage(x, s)], ...pulses(r, i + 1, s)]))) continue
    if (!(await play(run, i, TIMING.pause, (_, s) => pulses(r, i + 1, s)))) continue
    if (!(await play(run, i, TIMING.flip[x.rarity], t => [['cer-stage', flipStage(x, t)]]))) continue
    await ctl.flip(i + 1)
    const key = i + 1 < n || r.bulk ? 'cer-stage' : `sum-${i}-art`
    await play(run, i + 1, holdMs(x, r), (_, s) => [[key, faceStage(x, s)], ...pulses(r, i + 1, s)])
  }
}
