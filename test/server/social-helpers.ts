// Shared by the social tests, on top of scaffold-helpers: older players, fresh
// tradeable cards, listings and wishes, whole-database snapshots for the authorization matrix, and
// the checks for anything one player may see of another (SPEC 20.3, 26.7).
import assert from 'node:assert/strict'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { BattleCard, Card, Family, Rarity } from '../../plugin/hooks/core/types.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { DAY } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

/** What another player may see of a card; never `raisedIn`, since the arena is its owner's model (SPEC 20.3). */
export const BATTLE_CARD_KEYS = new Set([
  'id', 'species', 'form', 'season', 'family', 'rarity', 'shiny', 'foil', 'dna', 'genes', 'traits', 'level', 'stage', 'stats', 'firstFind',
])

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
export const envOf = (s: Server) => ({ db: s.db, now: s.now(), randomBytes: random })

/** An older account: joined 3 days ago, with 10 finished battles. Trading needs neither any more (SPEC 8). */
export async function trust(s: Server, ...players: Player[]): Promise<void> {
  for (const p of players) await s.db.batch([stmt('UPDATE players SET joined = ?, battles = 10 WHERE id = ?', utcDay(s.now() - 3 * DAY), p.id)])
}

/** Fresh tradeable cards of the current season, straight into the player's collection. */
export async function fresh(s: Server, p: Player, n: number, o: { family?: Family; rarity?: Rarity; species?: string } = {}): Promise<Card[]> {
  const rng = rngFromSeed(crypto.randomUUID())
  const cards = Array.from({ length: n }, (_, i) => {
    const c = mintFor(o.family ?? (['haiku', 'sonnet', 'opus', 'fable'] as const)[i % 4]!, o.rarity ?? 'common', rng, s.now(), 'pack')
    if (!o.species) return c
    const family = o.species.split('-')[1] as Family
    return { ...c, species: o.species, family }
  })
  const { cards: minted, stmts } = await mintCards(envOf(s), p.id, cards)
  await s.db.batch(stmts)
  return minted
}

/** Lists cards for trade through the real endpoint. */
export async function list(p: Player, ...cards: Card[]): Promise<void> {
  for (const c of cards) await p.call('setForTrade', { cardId: c.id, forTrade: true })
}

/** Every row of every table, for "leaves every table unchanged". */
export async function snapshot(db: Db): Promise<Record<string, unknown[]>> {
  const tables = await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_KV') ORDER BY name`)
  const out: Record<string, unknown[]> = {}
  for (const { name } of tables) out[name] = (await db.all(`SELECT * FROM "${name}"`)).map(r => JSON.stringify(r)).sort()
  return out
}

/** A card another player sees: only BattleCard fields, nothing about ownership, time or listing. */
export function assertPublic(card: BattleCard, where: string): void {
  for (const k of Object.keys(card)) assert.ok(BATTLE_CARD_KEYS.has(k), `${where}: ${k} must not be shown to others`)
}

/** Nothing in an answer names a player by id (only handles ever leave the server). */
export function assertNoIds(body: unknown, ids: readonly string[], where: string): void {
  const json = JSON.stringify(body)
  for (const id of ids) assert.ok(!json.includes(id), `${where}: carries a player id`)
}

export const midnight = (t: number) => t % DAY === 0
