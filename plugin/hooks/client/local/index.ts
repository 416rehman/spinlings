// LocalBackend: the offline world (SPEC 28). It answers every operation API_ROUTES marks `offline` from the save under
// `offline:v1`, using only the shared core rules, crypto randomness and the injected clock; everything else is
// `not_allowed`. It never touches the network. Each operation goes through one door, like RemoteBackend's: the
// request is checked by the same strict schema, the save is loaded right before it is written (sessions share the
// store), the touch runs, the operation decides, the answer is checked by the same response schema, and only then is
// the save written, once. A save another session wrote meanwhile sends the operation round again on the fresh one.
import type { ApiOp, ApiRequest, ApiResponse } from '../../core/api.ts'
import { API_ROUTES } from '../../core/api.ts'
import type { Card } from '../../core/types.ts'
import { isFamily } from '../../core/families.ts'
import { parsePathParam, parseRequest, parseResponse } from '../../core/schemas.ts'
import { GENERATOR_VERSION, seasonSpecies, resolveCards } from '../../core/species.ts'
import { seasonOf, worldOf } from '../../core/world.ts'
import type { Backend, LocalDeps } from '../types.ts'
import { BackendError } from '../types.ts'
import { catchCreature, finishBattle, startBattle } from './battles.ts'
import { buyPack, chargePack, craft, fuseCards, openPack, recycle, setTeam, trader, traderDeal } from './collection.ts'
import type { LocalState } from './save.ts'
import { encodeState, LIMITS, openSave, stampOf } from './save.ts'
import type { Ctx } from './state.ts'
import { meView, randomId, refuse, TEXT } from './state.ts'
import { firstRun, touch } from './touch.ts'

export { LIMITS, SAVE_VERSION } from './save.ts'
export { OFFLINE_HANDLE } from './state.ts'

type Handler<K extends ApiOp> = (s: LocalState, ctx: Ctx, req: ApiRequest<K>) => ApiResponse<K>
type OfflineOps = {
  [K in ApiOp]?: { write: boolean; run: Handler<K> }
}

const read = <K extends ApiOp>(run: Handler<K>) => ({ write: false, run })
const write = <K extends ApiOp>(run: Handler<K>) => ({ write: true, run })

/** Every offline operation (deleteMe aside), and whether it changes the save beyond the touch. */
const OPS: OfflineOps = {
  season: read<'season'>((s, ctx, req) => {
    const season = Number(req.season)
    if (season > seasonOf(ctx.now)) refuse('not_found', 'That season has not begun')
    const generator = s.generators[String(season)] ?? GENERATOR_VERSION
    return { season, generator, species: [...seasonSpecies(season, ctx.catalog, generator)] }
  }),
  world: read<'world'>((_s, ctx) => ({ ...worldOf(ctx.now, ctx.catalog), players: 1 })),
  me: read<'me'>((s, ctx) => meView(s, ctx.now)),
  cards: read<'cards'>(s => ({ cards: s.cards, version: s.cardsVersion })),
  trader: read<'trader'>((s, ctx) => trader(s, ctx)),
  chargePack: write<'chargePack'>(chargePack),
  buyPack: write<'buyPack'>(buyPack),
  openPack: write<'openPack'>(openPack),
  setTeam: write<'setTeam'>(setTeam),
  startBattle: write<'startBattle'>(startBattle),
  finishBattle: write<'finishBattle'>(finishBattle),
  catchCreature: write<'catchCreature'>(catchCreature),
  fuse: write<'fuse'>(fuseCards),
  recycle: write<'recycle'>(recycle),
  craft: write<'craft'>(craft),
  traderDeal: write<'traderDeal'>(traderDeal),
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The request as RemoteBackend would send it: path parameters by their formats, the body by its strict schema. */
function checkRequest(op: ApiOp, req: unknown): Record<string, unknown> {
  const bad = (): never => refuse('bad_request', 'That request is not one the offline world takes')
  if (!isRecord(req)) return bad()
  const rest: Record<string, unknown> = { ...req }
  const params: Record<string, unknown> = {}
  for (const [, name] of API_ROUTES[op].path.matchAll(/:([A-Za-z]+)/g)) {
    const v = rest[name!]
    delete rest[name!]
    if (typeof v !== 'string' && typeof v !== 'number') return bad()
    try {
      parsePathParam(name!, String(v))
    } catch {
      return bad()
    }
    params[name!] = v
  }
  try {
    return { ...(parseRequest(op, rest) as Record<string, unknown>), ...params }
  } catch {
    return bad()
  }
}

/** The answer as RemoteBackend would read it; an answer that is not the documented shape never gets saved. */
function checkResponse<K extends ApiOp>(op: K, out: ApiResponse<K>): ApiResponse<K> {
  try {
    return parseResponse(op, out) as ApiResponse<K>
  } catch {
    return refuse('unavailable', TEXT.stumbled)
  }
}

/**
 * The offline engine's entry point (client/types.ts LocalBackendFactory): a Backend over the injected save, clock,
 * randomness and family. Calls run one at a time, in order.
 */
export function createLocalBackend(deps: LocalDeps): Backend {
  let queue: Promise<unknown> = Promise.resolve()

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }

  async function transact<K extends ApiOp>(op: K, req: ApiRequest<K>): Promise<ApiResponse<K>> {
    const now = await deps.now()
    const rng = () => deps.random()
    const ctx: Ctx = { now, rng, id: () => randomId(rng) }
    const entry = OPS[op] as { write: boolean; run: Handler<K> } | undefined
    if (!entry) return refuse('not_allowed', TEXT.online)
    for (let attempt = 0; ; attempt++) {
      const raw = await deps.load()
      const opened = openSave(raw)
      if (opened.kind === 'newer') return refuse('unavailable', TEXT.newer)
      if (opened.kind === 'unreadable') return refuse('unavailable', TEXT.unreadable)
      const fresh = opened.kind === 'empty'
      const family = deps.family()
      const s = opened.kind === 'ok' ? opened.state : firstRun(ctx, isFamily(family) ? family : 'sonnet')
      ctx.catalog = s.catalog
      const touched = touch(s, ctx)
      const answer = resolveCards(checkResponse(op, entry.run(s, ctx, req)), s.catalog)
      if (!fresh && !touched && !entry.write) return answer
      const encoded = encodeState(s, randomId(rng))
      const size = JSON.stringify(encoded).length
      if (size > LIMITS.bytes && (fresh || size > JSON.stringify(raw).length)) {
        if (!entry.write) return answer
        return refuse('cap_reached', TEXT.full)
      }
      // another session wrote since this one read: decide again on what it wrote
      if (attempt < 2 && stampOf(await deps.load()) !== (opened.kind === 'ok' ? opened.stamp : null)) continue
      try {
        await deps.save(encoded)
      } catch {
        // the touch alone can wait for the next write; a change the player asked for cannot pretend to have happened
        if (entry.write) return refuse('cap_reached', TEXT.storeFull)
      }
      return answer
    }
  }

  async function call<K extends ApiOp>(op: K, req: ApiRequest<K>): Promise<ApiResponse<K>> {
    return serial(async (): Promise<ApiResponse<K>> => {
      if (!Object.hasOwn(API_ROUTES, op) || !API_ROUTES[op].offline) return refuse('not_allowed', TEXT.online)
      const checked = checkRequest(op, req) as ApiRequest<K>
      try {
        if (op === 'deleteMe') {
          // the player asked: the whole save goes, whatever state it is in
          await deps.save(null)
          return { deleted: true } as ApiResponse<K>
        }
        return await transact(op, checked)
      } catch (err) {
        // a store that failed, or a rule that tripped: one plain line, and the save as it was
        if (err instanceof BackendError) throw err
        return refuse('unavailable', TEXT.stumbled)
      }
    })
  }

  const api: Record<string, unknown> = { call }
  for (const op of Object.keys(API_ROUTES) as ApiOp[]) api[op] = (req: never) => call(op, req)
  return api as unknown as Backend
}

/**
 * The cards to suggest recycling when the collection nears its limit (SPEC 28): plain commons that are free to go and
 * not on the team, oldest first.
 */
export function recycleSuggestions(cards: readonly Card[], team: readonly string[], count = 20): Card[] {
  return cards
    .filter(c => c.rarity === 'common' && !c.bound && !c.shiny && !c.foil && c.state === 'owned' && !team.includes(c.id) && /^s\d/.test(c.species))
    .sort((a, b) => a.mintedAt - b.mintedAt || (a.id < b.id ? -1 : 1))
    .slice(0, count)
}
