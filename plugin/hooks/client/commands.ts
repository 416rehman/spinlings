// `/spin` and its subcommands (SPEC 9), parsed into plain values. Commands only open views or change settings: no
// command ever hands out a card (SPEC 13). Every command answers `{}`; text goes to $.ui.log, which the model never reads.
import type { Card } from '../core/types.ts'
import { DROP_CODE_RE, GIFT_CODE_RE, HANDLE_RE } from '../core/schemas.ts'
import { cardName } from '../core/cards.ts'
import { safe } from './text.ts'
import type { World } from './types.ts'

export type SpinCommand =
  | { kind: 'open' }
  | { kind: 'battle' }
  | { kind: 'pack' }
  | { kind: 'team'; refs: string[] }
  | { kind: 'trade'; handle: string }
  | { kind: 'gift'; ref: string }
  | { kind: 'claim'; code: string }
  | { kind: 'share'; ref: string | null }
  | { kind: 'redeem'; code: string }
  | { kind: 'world'; world: World | null }
  | { kind: 'devices' }
  | { kind: 'quiet'; on: boolean | null }
  | { kind: 'motion'; on: boolean }
  | { kind: 'sound'; on: boolean }
  | { kind: 'privacy' }
  | { kind: 'server'; url: string | null }
  | { kind: 'demo' }
  | { kind: 'leaderboard'; on: boolean | null }
  | { kind: 'handle'; reroll: boolean }
  | { kind: 'help'; text: string }

export const USAGE = [
  '/spin                   your team, cards, album and trades',
  '/spin battle            challenge a duel',
  '/spin pack              open a waiting pack',
  '/spin team a b c        set your team (card names or ids)',
  '/spin trade <handle>    see a player\'s cards for trade',
  '/spin gift <card>       wrap a card as a gift code',
  '/spin claim <code>      claim a gift',
  '/spin share [card]      copy a card to share',
  '/spin redeem <code>     redeem a drop code',
  '/spin world online|offline   switch worlds (each keeps its own collection)',
  '/spin devices           devices and passkey',
  '/spin quiet [on|off]    silence everything',
  '/spin motion on|off     animations',
  '/spin sound on|off      little chimes',
  '/spin privacy           what Spinlings sends, and your data',
  '/spin leaderboard [on|off]   the top players; join or leave it',
  '/spin handle [new]      your handle; draw a new one once a week',
  '/spin server [url|default]   play on a community server',
  '/spin demo              every screen, for a look around',
].join('\n')

const onOff = (v: string | undefined): boolean | null => (v === 'on' ? true : v === 'off' ? false : null)

export function parseCommand(args: string): SpinCommand {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  const [sub, ...rest] = words
  const help = (why: string): SpinCommand => ({ kind: 'help', text: why ? `${why}\n${USAGE}` : USAGE })
  const arg = (rest[0] ?? '').toLowerCase()
  switch ((sub ?? '').toLowerCase()) {
    case '': return { kind: 'open' }
    case 'battle': case 'duel': return { kind: 'battle' }
    case 'pack': case 'packs': return { kind: 'pack' }
    case 'team':
      if (rest.length < 1 || rest.length > 3) return help('Name one to three cards.')
      return { kind: 'team', refs: rest }
    case 'trade':
      if (rest.length !== 1 || !HANDLE_RE.test(rest[0]!)) return help('Name one player, like quiet-otter-42.')
      return { kind: 'trade', handle: rest[0]! }
    case 'gift':
      if (rest.length < 1) return help('Name the card to gift.')
      return { kind: 'gift', ref: rest.join(' ') }
    case 'claim':
      if (rest.length !== 1 || !GIFT_CODE_RE.test(arg)) return help('A gift code looks like quiet-otter-lamp-4821.')
      return { kind: 'claim', code: arg }
    case 'share': return { kind: 'share', ref: rest.length > 0 ? rest.join(' ') : null }
    case 'redeem': {
      const code = rest.join(' ')
      if (code.length < 3 || code.length > 40 || !DROP_CODE_RE.test(code)) return help('A drop code looks like FOUNDERS.')
      return { kind: 'redeem', code }
    }
    case 'world':
      if (rest.length === 0) return { kind: 'world', world: null }
      if (arg === 'online' || arg === 'offline') return { kind: 'world', world: arg }
      return help('Use /spin world online or /spin world offline.')
    case 'devices': return { kind: 'devices' }
    case 'quiet': {
      if (rest.length === 0) return { kind: 'quiet', on: null }
      const on = onOff(arg)
      return on === null ? help('Use /spin quiet on or /spin quiet off.') : { kind: 'quiet', on }
    }
    case 'motion': {
      const on = onOff(arg)
      return on === null ? help('Use /spin motion on or /spin motion off.') : { kind: 'motion', on }
    }
    case 'sound': {
      const on = onOff(arg)
      return on === null ? help('Use /spin sound on or /spin sound off.') : { kind: 'sound', on }
    }
    case 'privacy': return { kind: 'privacy' }
    case 'server': return { kind: 'server', url: rest[0] ?? null }
    case 'demo': return { kind: 'demo' }
    case 'leaderboard': {
      if (rest.length === 0) return { kind: 'leaderboard', on: null }
      const on = onOff(arg)
      return on === null ? help('Use /spin leaderboard, /spin leaderboard on or /spin leaderboard off.') : { kind: 'leaderboard', on }
    }
    case 'handle':
      if (rest.length === 0) return { kind: 'handle', reroll: false }
      return arg === 'new' ? { kind: 'handle', reroll: true } : help('Use /spin handle, or /spin handle new to draw a new one.')
    case 'help': return help('')
    default: return help(`There is no /spin ${safe(sub, 20)}.`)
  }
}

/** A card by exact id, else by name (any case) when exactly one card carries it. */
export function findCard(cards: readonly Card[], ref: string): Card | { error: string } {
  const byId = cards.find(c => c.id === ref)
  if (byId) return byId
  const want = ref.trim().toLowerCase()
  const named = cards.filter(c => {
    try {
      return cardName(c).toLowerCase() === want
    } catch {
      return false
    }
  })
  if (named.length === 1) return named[0]!
  if (named.length > 1) return { error: `You have ${named.length} called ${safe(ref, 40)}; pick one in /spin, Cards.` }
  return { error: `No card called ${safe(ref, 40)}.` }
}
