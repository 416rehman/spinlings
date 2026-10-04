// Frozen appearance belongs to one server origin. It is resolved after wire validation, never sent back to a server.
import type { SeasonResponse } from '../core/api.ts'
import type { Species } from '../core/types.ts'
import { parseSeasonResponse } from '../core/schemas.ts'
import { SPECIES_ID, installSeason, resolveCards } from '../core/species.ts'
import type { SeasonCatalog } from '../core/species.ts'
import { KEYS } from './store.ts'

/** Small, disposable first-party appearance cache; cards, sessions and offline saves have their own keys. */
export const SEASON_CACHE_BYTES = 128 * 1024
type SeasonStore = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

export function createSeasonCache(store: SeasonStore, budget = SEASON_CACHE_BYTES) {
  const sizes = new Map<string, number>()
  let bytes = 0, ready: Promise<void> | null = null, writes = Promise.resolve()
  const sizeOf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
  const prune = async () => {
    for (const [key, size] of sizes) {
      if (bytes <= budget) break
      await store.delete(key)
      sizes.delete(key); bytes -= size
    }
  }
  const initialize = () => ready ??= (async () => {
    for (const key of await store.keys()) {
      if (!/^server:https?:\/\/[^/]+:season:[1-9]\d{0,3}$/.test(key)) continue
      const value = await store.get(key)
      if (value === undefined || value === null) continue
      const size = sizeOf(value)
      sizes.set(key, size); bytes += size
    }
    await prune()
  })()
  return {
    async read(origin: string, season: number): Promise<unknown> {
      await initialize()
      const key = KEYS.season(origin, season), size = sizes.get(key)
      if (size !== undefined) { sizes.delete(key); sizes.set(key, size) }
      return store.get(key)
    },
    write(origin: string, season: number, data: SeasonResponse): Promise<void> {
      const next = writes.catch(() => undefined).then(async () => {
        await initialize()
        const key = KEYS.season(origin, season), size = sizeOf(data)
        if (size > budget) return
        await store.set(key, data)
        bytes -= sizes.get(key) ?? 0
        sizes.delete(key); sizes.set(key, size); bytes += size
        await prune()
      })
      writes = next
      return next
    },
  }
}

export type FrozenDeps = {
  read(season: number): Promise<unknown>
  write(season: number, value: SeasonResponse): Promise<void>
  fetch(season: number): Promise<SeasonResponse>
  now(): Promise<number>
  changed(species: Species[]): Promise<void>
}

/** JSON-safe account snapshot to an explicit catalog, also usable by a view after a module reload. */
export function catalogOf(account: { world: string; species?: readonly Species[] }): SeasonCatalog | undefined {
  if (!account.species) return undefined
  const map = new Map<number, Species[]>()
  for (const s of account.species) {
    const list = map.get(s.season) ?? []
    list.push(s)
    map.set(s.season, list)
  }
  return map
}

function seasonsIn(value: unknown, out: Set<number>): void {
  const reference = (id: unknown) => {
    const match = typeof id === 'string' ? SPECIES_ID.exec(id) : null
    if (match) out.add(Number(match[1]))
  }
  if (Array.isArray(value)) {
    for (const item of value) seasonsIn(item, out)
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'species') reference(item)
      else if ((key === 'parents' || key === 'wishlist') && Array.isArray(item)) item.forEach(reference)
      // Names and notices can look like species IDs. Only structural references request frozen forms.
      if (key !== 'appearance' && key !== 'parentForms' && key !== 'seen') seasonsIn(item, out)
    }
  }
}

export { resolveCards as resolveAnswer } from '../core/species.ts'

export function createFrozenCatalog(deps: FrozenDeps) {
  const catalog = new Map<number, readonly Species[]>()
  const pending = new Map<number, Promise<void>>()
  const retryAt = new Map<number, number>()

  async function load(season: number, wanted: () => boolean): Promise<void> {
    if (!wanted()) return
    if (catalog.has(season)) return
    if (pending.has(season)) return pending.get(season)!
    const at = await deps.now()
    if (pending.has(season)) return pending.get(season)!
    if (catalog.has(season)) return
    if ((retryAt.get(season) ?? 0) > at) return
    const done = (async () => {
      let data: SeasonResponse | null = null
      try {
        data = parseSeasonResponse(await deps.read(season))
        if (data.season !== season) data = null
      } catch { /* an absent cache is fetched from this origin */ }
      if (!wanted()) return
      try {
        if (!data) data = parseSeasonResponse(await deps.fetch(season))
        if (data.season !== season || !installSeason(season, data.species, catalog)) throw new Error('wrong season')
        retryAt.delete(season)
        // Storage can be full without preventing the fetched appearance from being used for this session.
        try { await deps.write(season, data) } catch { /* the immutable catalog remains usable */ }
      } catch {
        retryAt.set(season, at + 60_000)
      }
    })().finally(() => { if (pending.get(season) === done) pending.delete(season) })
    pending.set(season, done)
    return done
  }

  async function hydrate<T>(value: T, extra: readonly number[] = [], wanted: () => boolean = () => true): Promise<T> {
    const needed = new Set(extra)
    seasonsIn(value, needed)
    // Bounded concurrency, without dropping the ninth or any later season of a real collection.
    const list = [...needed]
    for (let i = 0; i < list.length && wanted(); i += 4) await Promise.all(list.slice(i, i + 4).map(n => load(n, wanted)))
    if (wanted()) await deps.changed([...catalog.values()].flatMap(s => [...s]))
    return resolveCards(value, catalog)
  }

  return { catalog, hydrate }
}

export type FrozenCatalog = ReturnType<typeof createFrozenCatalog>
