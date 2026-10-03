// The band above the prompt (SPEC 9, 13, 14, 21, 34): every live moment in at most four rows, from 40 columns up, the
// same information in the same order on the terminal and the desktop. The terminal draws each moment's resting frame
// as keyed Rasters that client/scheduler.ts animates by blit; the desktop draws one Svg per moment that animates
// itself. Every band button uses a digit, the only keys an empty prompt hands to the band: 1 is the one primary
// action, 2 the secondary, 1 to 3 a catch choice. Returns null when nothing is live, so the engine's band shows.
import type { RenderElement } from 'claude-code'
import type { Card } from '../core/types.ts'
import { FAMILY_INFO } from '../core/families.ts'
import type { Pixels } from '../core/sprite.ts'
import { TIMING, blank, pixelCells, silhouette, sparkles } from '../client/anim.ts'
import type { Line, OutcomeMoment, Side } from '../client/battleview.ts'
import {
  KEYS, MINI, bandKind, battleWords, catchCard, catchFrame, catchPreMs, choiceSeconds, evolveFrame, evolveGains,
  evolveStage, EVOLVE_SHOW, fightersAt, fighterCells, fighterLayout, fledFrame, foreshadowOf, gainsWords, hatchFrame,
  leadCard, lineWidth, logOf, noteLayout, outcomeAnchor, outcomeBadges, outcomeDetail, outcomeHeadline,
  outcomeStage, packFamily, packFrame, presentFrame, rarityWords, restLook, revealFrame, roundOnScreen, roundPlan,
  rustleFrame, SHADOW, spriteOf,
} from '../client/battleview.ts'
import { ROUND_MS, catchOrder, headMoment, nameOf } from '../client/game.ts'
import { hostOf } from '../client/net.ts'
import { UPDATE_COMMAND } from '../client/remote.ts'
import { fit, plural, safe } from '../client/text.ts'
import type { Actions, Battle, BandView, El, Moment, Surface } from '../client/types.ts'
import {
  ART_K, HUD, artSide, catchSvg, creatureSvg, evolveSvg, fledSvg, hatchSvg, hudSize, hudSvg, optionSvg, packSvg, presentSvg,
  revealSvg, rustleSvg,
} from './band-art.tsx'
import { FAMILY_COLOR, INK, MARK, MYTHIC_COLOR, RARITY_COLOR, RARITY_INITIAL, SPACE } from './tokens.ts'

type Env = Parameters<BandView>[0]
/** `rows`: the band's window on the terminal (maxRows, at most 4); below 4 each moment draws its compact form. */
type Ctx = { el: El; surface: Surface; columns: number; rows: number; actions: Actions; motion: boolean; now: number }

/** Columns a desktop plate takes, as text beside it counts them. */
const DESK_ART_COLUMNS = 9

// ---------- small pieces ----------

/** A styled line: one Text of runs, cut with an ellipsis at the band's edge. */
function line(el: El, l: Line, key?: string): RenderElement {
  const { Text } = el
  const runs = l.filter(s => s.text !== '')
  if (runs.length === 0) return <Text> </Text>
  if (runs.length === 1 && !runs[0]!.color && !runs[0]!.bold && !runs[0]!.dim) return <Text wrap="truncate-end">{runs[0]!.text}</Text>
  const parts = runs.map(s => {
    const props: { color?: string; bold?: boolean; dimColor?: boolean } = {}
    if (s.color) props.color = s.color
    if (s.bold) props.bold = true
    if (s.dim) props.dimColor = true
    return <Text {...props}>{s.text}</Text>
  })
  return key ? <Text key={key} wrap="truncate-end">{...parts}</Text> : <Text wrap="truncate-end">{...parts}</Text>
}

const blankRow = (el: El) => <el.Text> </el.Text>

/** Guidance wraps onto a second row, except in a short window, where every row is one row. */
const wraps = (c: Ctx) => (c.rows < 4 ? 'truncate-end' : 'wrap')

/** Terminal art: a keyed Raster of pixels (8x8 minis are 8 x 4 cells). */
function raster(el: El, key: string, px: Pixels): RenderElement {
  const r = pixelCells(px)
  return <el.Raster key={key} columns={r.columns} rows={r.rows} cells={r.cells} />
}

function svg(el: El, source: string, alt: string, size: { w: number; h: number }, motion: boolean): RenderElement {
  return motion
    ? <el.Svg source={source} alt={alt} width={size.w} height={size.h} isInteractive={true} />
    : <el.Svg source={source} alt={alt} width={size.w} height={size.h} />
}

const plateSize = (k = ART_K) => ({ w: artSide(k), h: artSide(k) })

/**
 * Art beside a column of rows, the moment's actions last: the band's one shape for moments. In a window shorter than
 * four rows the art stays out and the actions come first, so the digit that presses them is always in view (a bare
 * digit only reaches the buttons inside the band's window).
 */
function beside(c: Ctx, art: RenderElement | null, rows: RenderElement[], o: { act?: RenderElement | null; rails?: string } = {}): RenderElement {
  const { Box, Text } = c.el
  if (c.rows < 4) return compact(c, [o.act ?? null, ...rows])
  const rail = o.rails ? <Box flexDirection="column" flexShrink={0}>{...[0, 1, 2, 3].map(() => <Text color={o.rails}>▎</Text>)}</Box> : null
  return (
    <Box flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
      {rail}
      {art ? <Box flexShrink={0}>{art}</Box> : null}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{...rows}{o.act ?? null}</Box>
      {rail}
    </Box>
  )
}

/** The compact band: one row each, as many as the window holds. */
function compact(c: Ctx, rows: (RenderElement | null)[]): RenderElement {
  return <c.el.Box flexDirection="column" width={c.columns}>{...rows.filter((r): r is RenderElement => r !== null).slice(0, Math.max(1, c.rows))}</c.el.Box>
}

/**
 * A row of the moment's actions: 1 the primary, 2 the secondary. In a short window the row may not wrap onto a second
 * line, so a long primary takes its `short` label when both would not fit across.
 */
function actionsRow(c: Ctx, m: Moment, primary: string | null, secondary: string | null, short?: string): RenderElement {
  const { Box, Button } = c.el
  const across = (primary ? 3 + primary.length : 0) + (secondary ? SPACE.loose + 3 + secondary.length : 0)
  const label = primary && short && c.rows < 4 && across > c.columns ? short : primary
  return (
    <Box flexDirection="row" columnGap={SPACE.loose} flexWrap="wrap">
      {label ? <Button key={`act-${m.id}`} label={label} hotkey="1" plain variant="primary" onPress={() => { void c.actions.act(m.id) }} /> : null}
      {secondary ? <Button key={`dismiss-${m.id}`} label={secondary} hotkey="2" plain dimColor onPress={() => { void c.actions.dismiss(m.id) }} /> : null}
    </Box>
  )
}

const textWidth = (c: Ctx, art: boolean) => Math.max(10, c.columns - (art ? (c.surface === 'terminal' ? MINI : DESK_ART_COLUMNS) + SPACE.tight : 0))

// ---------- the band ----------

/** The band slot (register.tsx): a live battle over everything, else the moment at the head of the queue. */
export const band: BandView = env => {
  noteLayout(env.columns, env.surface)
  const { state } = env
  const motion = state.prefs.motion && !state.prefs.quiet
  const rows = env.surface === 'terminal' && Number.isFinite(env.rows) && env.rows >= 1 ? Math.min(4, Math.floor(env.rows)) : 4
  const c: Ctx = { el: env.el, surface: env.surface, columns: Math.max(20, env.columns), rows, actions: env.actions, motion, now: env.now }
  if (state.battle) return battleBand(c, env, state.battle)
  // quiet silences the band except the result of a battle the player started themselves
  const moments = state.prefs.quiet ? state.moments.filter(m => m.kind === 'outcome') : state.moments
  const m = headMoment(moments)
  if (m) return momentBand(c, env, m)
  if (!state.prefs.quiet && state.account.link === 'joining' && !state.me) return hatching(c, env)
  return null
}

// ---------- battles ----------

function battleBand(c: Ctx, env: Env, b: Battle): RenderElement {
  const { el } = c
  const { Box, Text, Button } = el
  const words = battleWords(b, env.state)
  const lead = b.setup.defender[0] ?? null
  const cheering = env.state.signals.cheering
  if (c.rows < 4) return compactBattle(c, words)
  if (b.phase === 'rustle' || b.phase === 'reveal') {
    const fore = foreshadowOf(lead)
    // the roamer turns the band's border gold: rails on the terminal, the plate's own border on the desktop
    const gold = fore.gold && b.phase === 'rustle' && c.surface === 'terminal' ? INK.accent : undefined
    let art: RenderElement | null = null
    if (lead) {
      if (c.surface === 'terminal') {
        const px = spriteOf(lead, 'mini')
        art = raster(el, KEYS.lead, b.phase === 'rustle' ? rustleFrame(px, fore, 0, lead.id) : revealFrame(px, lead, c.motion ? 0 : 10_000, lead.id))
      } else {
        art = svg(el, b.phase === 'rustle' ? rustleSvg(lead, fore) : revealSvg(lead, ART_K, c.motion), b.phase === 'rustle' ? 'a rustling shadow' : `${nameOf(lead)}, ${rarityWords(lead)}`, plateSize(), c.motion)
      }
    }
    return beside(c, art, [
      <Text dimColor wrap="truncate-end">{fit(words.header, textWidth(c, true))}</Text>,
      line(el, words.banner),
      line(el, words.extra),
      cheering > 0 ? <Text color={INK.accent}>{`+${cheering} cheering`}</Text> : blankRow(el),
    ], { rails: gold })
  }
  const log = logOf(b)
  const r = log && b.shown >= log.rounds.length ? log.rounds.length + 1 : roundOnScreen(b, log)
  const f = fightersAt(b, log, r)
  const look = (side: Side) => restLook(f[side]?.hp ?? 0, (f[side]?.hp ?? 1) <= 0)
  const controls = words.now || cheering > 0
    ? (
      <Box flexDirection="row" columnGap={SPACE.loose}>
        {words.now ? <Button key="now" label="Now!" hotkey="1" plain variant="primary" onPress={() => { void c.actions.press() }} /> : null}
        {cheering > 0 ? <Text color={INK.accent}>{`+${cheering} cheering`}</Text> : null}
      </Box>
    )
    : blankRow(el)
  const kind = bandKind(c.columns)
  if (c.surface !== 'terminal') {
    const size = kind === 'wide' ? HUD.wide : HUD.narrow
    const plan = log && r <= log.rounds.length && b.phase === 'fight' ? roundPlan(b, log, r, ROUND_MS) : null
    const special = plan?.hits.find(h => h.actor === 'a' && h.action.move === 'special')
    const start = plan && b.inputs.includes(r) && special ? Math.max(0, special.at - 2 * TIMING.windup) : 0
    const hud = (side: Side) => svg(el, hudSvg(f[side], plan, side, size, { start, motion: c.motion }), f[side] ? `${f[side]!.name}, ${Math.ceil(f[side]!.hp)} of ${f[side]!.maxHp} HP` : 'empty', hudSize(size), c.motion)
    if (kind === 'wide') {
      return (
        <Box flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
          <Box flexShrink={0}>{hud('a')}</Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">{words.header}</Text>
            {line(el, words.banner)}
            {line(el, words.extra)}
            {controls}
          </Box>
          <Box flexShrink={0}>{hud('d')}</Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" width={c.columns}>
        <Text dimColor wrap="truncate-end">{words.header}</Text>
        <Box flexDirection="row" columnGap={SPACE.tight}>{hud('a')}{hud('d')}</Box>
        {narrowStory(c, words)}
      </Box>
    )
  }
  if (kind === 'wide') {
    const cells = (side: Side) => fighterCells(f[side], look(side), fighterLayout('wide', side))
    const a = cells('a'), d = cells('d')
    return (
      <Box flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
        <Box flexShrink={0}><el.Raster key={KEYS.a} columns={a.columns} rows={a.rows} cells={a.cells} /></Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">{words.header}</Text>
          {line(el, words.banner)}
          {line(el, words.extra)}
          {controls}
        </Box>
        <Box flexShrink={0}><el.Raster key={KEYS.d} columns={d.columns} rows={d.rows} cells={d.cells} /></Box>
      </Box>
    )
  }
  const w = lineWidth(c.columns)
  const art = fighterCells(f.d, look('d'), fighterLayout('art', 'd'))
  const aLine = fighterCells(f.a, look('a'), fighterLayout('line', 'a', w))
  const dLine = fighterCells(f.d, look('d'), fighterLayout('line', 'd', w))
  return (
    <Box flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
      <Box flexShrink={0}><el.Raster key={KEYS.dArt} columns={art.columns} rows={art.rows} cells={art.cells} /></Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">{words.header}</Text>
        <el.Raster key={KEYS.aLine} columns={aLine.columns} rows={1} cells={aLine.cells} />
        <el.Raster key={KEYS.dLine} columns={dLine.columns} rows={1} cells={dLine.cells} />
        {narrowStory(c, words)}
      </Box>
    </Box>
  )
}

const storyOf = (words: ReturnType<typeof battleWords>): Line =>
  words.banner.length && words.extra.length ? [...words.banner, { text: ' · ', dim: true }, ...words.extra] : [...words.banner, ...words.extra]

/** `1: Now!` first on a row, then `rest`: the press is always the row's first thing. */
function nowRow(c: Ctx, rest: RenderElement): RenderElement {
  const { Box, Button } = c.el
  return (
    <Box flexDirection="row" columnGap={SPACE.tight}>
      <Box flexShrink={0}><Button key="now" label="Now!" hotkey="1" plain variant="primary" onPress={() => { void c.actions.press() }} /></Box>
      <Box flexShrink={1}>{rest}</Box>
    </Box>
  )
}

/** The narrow band's last row: `1: Now!` when it is live, then the round's story. */
function narrowStory(c: Ctx, words: ReturnType<typeof battleWords>): RenderElement {
  const story = line(c.el, storyOf(words))
  return words.now ? nowRow(c, story) : story
}

/** A battle in a window under four rows: the words alone, `1: Now!` on the first row so its digit always reaches it. */
function compactBattle(c: Ctx, words: ReturnType<typeof battleWords>): RenderElement {
  const header = <c.el.Text dimColor wrap="truncate-end">{words.header}</c.el.Text>
  return compact(c, [words.now ? nowRow(c, header) : header, line(c.el, storyOf(words))])
}

// ---------- moments ----------

function momentBand(c: Ctx, env: Env, m: Moment): RenderElement {
  const { el } = c
  const { Text } = el
  switch (m.kind) {
    case 'welcome': {
      const lead = leadCard(env.state)
      const family = lead?.family ?? env.state.signals.family
      const art = c.surface === 'terminal'
        ? raster(el, KEYS.art, hatchFrame(lead ? spriteOf(lead, 'mini') : null, family, 10_000))
        : svg(el, hatchSvg(lead ? spriteOf(lead, 'full') : null, family, c.motion), lead ? `${nameOf(lead)} hatched` : 'an egg', plateSize(), c.motion)
      // a first run that fell back to the offline world says so here, never ahead of the payoff (SPEC 34.4)
      const sub = m.note ? safe(m.note, 80) : lead ? `${nameOf(lead)} leads your team of three` : 'Your team of three is ready'
      return beside(c, art, [
        <Text bold>{`${MARK.sparkle} A Spinling hatched!`}</Text>,
        <Text dimColor wrap="truncate-end">{sub}</Text>,
      ], { act: actionsRow(c, m, 'Open your welcome pack', 'Later') })
    }
    case 'outcome': return outcomeBand(c, env, m)
    case 'evolve': return evolveBand(c, env, m)
    case 'pack-ready': {
      const family = packFamily(env.state)
      const art = c.surface === 'terminal' ? raster(el, KEYS.art, packFrame(family, 0)) : svg(el, packSvg(family), `a ${FAMILY_INFO[family].name} pack`, plateSize(), c.motion)
      return beside(c, art, [
        <Text bold>A pack is ready!</Text>,
        <Text dimColor wrap="truncate-end">{`${plural(m.count, 'pack')} waiting · it charged while you were here`}</Text>,
      ], { act: actionsRow(c, m, 'Open', null) })
    }
    case 'present': {
      const art = c.surface === 'terminal' ? raster(el, KEYS.art, presentFrame(0)) : svg(el, presentSvg(), 'a wrapped present', plateSize(), c.motion)
      return beside(c, art, [
        <Text bold wrap="truncate-end">{`${safe(m.from, 40)} sent you a gift!`}</Text>,
        <Text dimColor wrap="truncate-end">It is wrapped and waiting</Text>,
      ], { act: actionsRow(c, m, 'Open', null) })
    }
    case 'update': return beside(c, null, [
      <Text wrap="truncate-end">{`Spinlings ${safe(m.version, 20)} is out`}</Text>,
      <Text dimColor wrap="truncate-end">{UPDATE_COMMAND}</Text>,
    ], { act: actionsRow(c, m, 'Got it', null) })
    case 'passkey': return beside(c, null, [
      <Text bold wrap="truncate-end">Save your collection with a passkey · no email, no password</Text>,
      <Text dimColor wrap={wraps(c)}>Without one, losing this computer loses your online cards.</Text>,
    ], { act: actionsRow(c, m, 'Save', 'Later') })
    case 'needs-online': return beside(c, null, [
      <Text wrap="truncate-end">This needs the online world</Text>,
    ], { act: actionsRow(c, m, 'Join online (fresh collection)', 'Stay offline', 'Join online') })
    case 'server': {
      const host = hostOf(m.origin)
      const a = env.state.account
      // already in use (a server already in play is the player's own OK), it only says so; offline, it is kept for later
      const act = a.server === m.origin ? actionsRow(c, m, 'Got it', null)
        : a.world === 'offline' ? actionsRow(c, m, 'Use it online', 'Cancel') : actionsRow(c, m, 'Connect', 'Cancel')
      return beside(c, null, [
        <Text bold wrap="truncate-end">{`${safe(host, 60)} is a community server run by someone else`}</Text>,
        <Text dimColor wrap={wraps(c)}>{c.surface !== 'terminal' || c.columns >= 100
          ? 'It receives the same anonymous game data as spinlings.dev, and never anything about your work.'
          : 'Same anonymous game data as spinlings.dev, never your work.'}</Text>,
      ], { act })
    }
    case 'line': {
      const props: { dimColor?: boolean; italic?: boolean } = {}
      if (m.tone !== 'notice') props.dimColor = true
      if (m.tone === 'reaction') props.italic = true
      return <el.Box width={c.columns}><Text {...props} wrap="truncate-end">{safe(m.text, 200)}</Text></el.Box>
    }
  }
}

function hatching(c: Ctx, env: Env): RenderElement {
  const { el } = c
  const family = env.state.signals.family
  const art = c.surface === 'terminal' ? raster(el, KEYS.art, hatchFrame(null, family, 0)) : svg(el, hatchSvg(null, family, c.motion), 'an egg', plateSize(), c.motion)
  return beside(c, art, [<el.Text dimColor>{`${MARK.sparkle} Something is hatching…`}</el.Text>])
}

/** The rest frame of a catch on the terminal, and its desktop plate. */
function catchArt(c: Ctx, m: OutcomeMoment, stage: ReturnType<typeof outcomeStage>): RenderElement | null {
  const { el } = c
  const card = catchCard(m)
  if (!card) return null
  const anchor = outcomeAnchor(m)
  const since = anchor === null ? 0 : Math.max(0, c.now - anchor)
  const status = m.outcome.catch.status
  const result = status === 'caught' ? 'caught' : status === 'slipped' ? 'slipped' : 'pending'
  if (c.surface === 'terminal') {
    const px = spriteOf(card, 'mini')
    let frame: Pixels
    if (stage === 'catching') frame = catchFrame(px, card, status === 'catching' ? 4 * TIMING.spinFrame : since, result === 'pending' ? 'pending' : result)
    else if (stage === 'caught') frame = sparkles(px, 0.4, card.id, { count: 2, color: 0xfff0a8, reach: 1 })
    else frame = silhouette(px, SHADOW)
    return raster(el, KEYS.art, frame)
  }
  const color = card.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[card.rarity]
  if (stage === 'catching') return svg(el, catchSvg(card, result, status === 'catching' ? 0 : since), `catching ${nameOf(card)}`, plateSize(), c.motion)
  if (stage === 'caught' && c.motion && anchor !== null && since < catchPreMs(card) + 2000) return svg(el, catchSvg(card, 'caught', since), `${nameOf(card)} caught`, plateSize(), c.motion)
  if (stage === 'caught') return svg(el, creatureSvg(spriteOf(card, 'full'), color, ART_K, { sparkle: c.motion }), `${nameOf(card)} caught`, plateSize(), c.motion)
  if (stage === 'slipped' && c.motion && anchor !== null && since < catchPreMs(card) + 1400) return svg(el, catchSvg(card, 'slipped', since), `${nameOf(card)} slipped away`, plateSize(), c.motion)
  return svg(el, creatureSvg(silhouette(spriteOf(card, 'full'), SHADOW), '#3a3646'), `${nameOf(card)} slipped away`, plateSize(), c.motion)
}

function outcomeBand(c: Ctx, env: Env, m: OutcomeMoment): RenderElement {
  const { el } = c
  const { Box, Text, Button } = el
  const stage = outcomeStage(m, c.now, c.motion)
  const o = m.outcome
  const badges = outcomeBadges(o)
  if (stage === 'choose' && o.catch.status === 'choose') {
    // rarest first, so 1, the primary, is also the one kept if you look away; each button names its server index
    const all = o.catch.options
    const order = catchOrder(all).slice(0, 3)
    const options = order.map(k => all[k]!)
    const pick = (i: number) => () => { void c.actions.pickCatch(order[i]!) }
    const secs = choiceSeconds(m, c.now)
    const hint = `${fit(nameOf(options[0]!), 12)}${secs > 0 && secs <= 20 ? ` in ${secs} s` : ''} if you look away`
    if (c.columns >= 100 && c.rows >= 4) {
      const tiles = options.map((x, i) => {
        const art = c.surface === 'terminal' ? raster(el, KEYS.option(i), spriteOf(x, 'mini')) : svg(el, optionSvg(x), `${nameOf(x)}, ${rarityWords(x)}`, plateSize(2), false)
        return (
          <Box key={`option-${i}`} flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
            <Box flexShrink={0}>{art}</Box>
            <Box flexDirection="column" width={13}>
              <Button key={`catch-${order[i]}`} label={fit(nameOf(x), 10)} hotkey={String(i + 1)} plain variant={i === 0 ? 'primary' : 'secondary'} onPress={pick(i)} />
              <Text color={x.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[x.rarity]} wrap="truncate-end">{rarityWords(x)}</Text>
              <Text dimColor>{`Lv ${x.level}`}</Text>
            </Box>
          </Box>
        )
      })
      return (
        <Box flexDirection="row" columnGap={SPACE.loose} width={c.columns}>
          <Box flexDirection="column" flexShrink={1} flexGrow={1}>
            <Text bold wrap="truncate-end">Won! Pick one to keep</Text>
            <Text dimColor wrap="truncate-end">{hint}</Text>
          </Box>
          {...tiles}
        </Box>
      )
    }
    // narrow: the creature kept if you look away beside the choices; a short window fits the three on one row
    const best = options[0]!
    const preview = c.surface === 'terminal' ? raster(el, KEYS.option(0), spriteOf(best, 'mini')) : svg(el, optionSvg(best), `${nameOf(best)}, ${rarityWords(best)}`, plateSize(2), false)
    const room = c.rows < 4 ? Math.max(4, Math.floor((c.columns - SPACE.loose * (options.length - 1)) / options.length) - 5) : 12
    return beside(c, preview, [
      <Text bold wrap="truncate-end">Won! Pick one to keep</Text>,
      <Text dimColor wrap="truncate-end">{hint}</Text>,
    ], {
      act: (
        <Box flexDirection="row" columnGap={SPACE.loose} flexWrap="wrap">
          {...options.map((x, i) => (
            <Box key={`option-${i}`} flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
              <Button key={`catch-${order[i]}`} label={fit(nameOf(x), room)} hotkey={String(i + 1)} plain variant={i === 0 ? 'primary' : 'secondary'} onPress={pick(i)} />
              <Text color={x.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[x.rarity]}>{x.species === 'mythic' ? 'M' : RARITY_INITIAL[x.rarity]}</Text>
            </Box>
          ))}
        </Box>
      ),
    })
  }
  let art: RenderElement | null
  if (stage === 'catching' || stage === 'caught' || stage === 'slipped') art = catchArt(c, m, stage)
  else if (stage === 'fled') {
    const card = o.lead
    art = !card ? null : c.surface === 'terminal'
      ? raster(el, KEYS.art, c.motion ? fledFrame(spriteOf(card, 'mini'), Math.max(0, c.now - (outcomeAnchor(m) ?? c.now)), card.id) : blank(MINI, MINI))
      : svg(el, fledSvg(card, Math.max(0, c.now - (outcomeAnchor(m) ?? c.now)), c.motion), 'gone into the static', plateSize(), c.motion)
  } else {
    const hero = (o.bounty ?? leadCard(env.state) ?? o.lead) as Card | null
    if (!hero) art = null
    else if (c.surface === 'terminal') {
      const px = spriteOf(hero, 'mini')
      art = raster(el, KEYS.art, o.result === 'win' ? sparkles(px, 0.4, hero.id, { count: 2, color: 0xfff0a8, reach: 1 }) : px)
    } else {
      art = svg(el, creatureSvg(spriteOf(hero, 'full'), FAMILY_COLOR[hero.family], ART_K, { sparkle: o.result === 'win' && c.motion }), nameOf(hero), plateSize(), c.motion)
    }
  }
  const head = outcomeHeadline(m, stage)
  const detail = outcomeDetail(m, stage, env.state.account.world === 'offline')
  const rows: RenderElement[] = [line(el, head)]
  if (detail.length > 0) rows.push(line(el, detail))
  if (stage !== 'catching' && badges.length > 0) rows.push(line(el, badges))
  return beside(c, art, rows.slice(0, 3), { act: stage === 'catching' ? null : actionsRow(c, m, stage === 'caught' ? 'See it' : 'Open', null) })
}

function evolveBand(c: Ctx, env: Env, m: Extract<Moment, { kind: 'evolve' }>): RenderElement {
  const { el } = c
  const { Text } = el
  const card = env.state.cards.find(x => x.id === m.cardId) as Card | undefined
  const stage = evolveStage(m, c.now, c.motion)
  const since = m.until === null ? TIMING.evolve : Math.max(0, c.now - (m.until - EVOLVE_SHOW))
  let art: RenderElement | null = null
  if (card) {
    const prev = Math.max(1, m.stage - 1) as 1 | 2 | 3
    if (c.surface === 'terminal') {
      const from = spriteOf({ ...card, stage: prev }, 'mini'), to = spriteOf({ ...card, stage: m.stage }, 'mini')
      art = raster(el, KEYS.art, stage === 'evolving' ? evolveFrame(from, to, since) : to)
    } else {
      const from = spriteOf({ ...card, stage: prev }, 'full'), to = spriteOf({ ...card, stage: m.stage }, 'full')
      const color = card.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[card.rarity]
      art = stage === 'evolving' || (c.motion && since < TIMING.evolve + 1500)
        ? svg(el, evolveSvg(from, to, stage === 'evolving' ? since : TIMING.evolve, color), `${safe(m.from, 24)} evolving`, plateSize(), c.motion)
        : svg(el, creatureSvg(to, color, ART_K, { sparkle: c.motion }), safe(m.to, 24), plateSize(), c.motion)
    }
  }
  if (stage === 'evolving') {
    return beside(c, art, [
      <Text bold wrap="truncate-end">{`What? ${safe(m.from, 24)} is evolving!`}</Text>,
      <Text dimColor wrap="truncate-end">{m.stage === 3 ? 'Its final stage' : 'Its next stage'}</Text>,
    ])
  }
  const gains = card ? gainsWords(evolveGains(card, m.stage)) : ''
  const raised = card?.raisedIn ? `Raised under ${FAMILY_INFO[card.raisedIn].name}` : ''
  const rows: RenderElement[] = [<Text bold wrap="truncate-end">{`${safe(m.from, 24)} evolved into ${safe(m.to, 24)}!`}</Text>]
  if (gains) rows.push(<Text color={INK.good} wrap="truncate-end">{gains}</Text>)
  if (raised) rows.push(<Text dimColor wrap="truncate-end">{raised}</Text>)
  return beside(c, art, rows, { act: actionsRow(c, m, 'Look', null) })
}
