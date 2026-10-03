// Row shapes for server/migrations, column for column: the SQL lives in the migration files, which
// wrangler applies to D1 and the Node server applies at start. JSON columns are strings here,
// booleans are 0 / 1, days are 'YYYY-MM-DD' UTC and *_at / *_until columns are ms epoch.

export type SessionRow = { id: string; player_id: string; token_hash: string; created_day: string; last_used_day: string }

export type PlayerRow = {
  id: string; handle: string; version: number
  joined: string; last_seen: string; handle_day: string; season: number
  sparks: number; rating: number; streak: number
  battles: number; battle_day: string; battle_days: number; wild_won: number; leaderboard: number
  team: string; team_size: number; cards_version: number; recent_opponents: string
  hello_day: string; first_win_day: string
  last_wild_at: number; last_duel_at: number; last_charge_at: number; charges: string
  claim_hour: number; claim_tries: number
}

export type CardRow = {
  id: string; owner_id: string; version: number; species: string; form: string | null; season: number
  family: string; rarity: string; shiny: number; foil: number; dna: number; genes: string; traits: string
  level: number; xp: number; stage: number; stats: string; power: number; bound: number; for_trade: number
  origin: string; minted: string; locked_until: number; tired_until: number; state: string; escrow_ref: string | null
  first_find: number; arena_haiku: number; arena_sonnet: number; arena_opus: number; arena_fable: number
  raised_in: string | null
}

export type AlbumRow = { player_id: string; species: string }
export type WishRow = { player_id: string; species: string; pos: number }
export type FusionRow = { id: number; player_id: string; form: string; day: string }
export type PackRow = { id: string; owner_id: string; family: string; source: string; created: string; lock_until: number; bound: number }

export type BattleRow = {
  id: string; attacker_id: string; defender_id: string | null; kind: string; version: number; state: string
  setup: string; opponent: string; rules: number; started_at: number; finish_after: number; revenge: number
  settled: string | null; result: string | null; outcome: string | null; catch_options: string | null; catch_until: number
}

export type OfferRow = {
  id: string; version: number; from_id: string; to_id: string; from_handle: string; to_handle: string
  give: string; get: string; state: string
  created: string; expires_at: number; resolved: string | null
}

export type GiftRow = {
  code: string; version: number; giver_id: string; card_id: string; state: string
  created: string; expires: string; claimed_by: string | null; resolved: string | null; bonus: number
}

export type NoticeRow = {
  id: string; player_id: string; day: string; kind: string; text: string
  other_id: string | null; revenge_until: number | null
}

export type FirstRow = { species: string; season: number; player_id: string | null; card_id: string; day: string }
export type MythicRow = { card_id: string; name: string; finder_id: string | null; handle: string | null; day: string }
export type TraderUseRow = { player_id: string; day: string; deal: number }
export type RetiredHandleRow = { handle: string; until: string }
export type ChallengeRow = { id: string; difficulty: number; expires_at: number }
export type JoinCounterRow = { key: string; hour: number; challenges: number; joins: number; auth: number; redeem: number }

export type PasskeyRow = {
  id: string; player_id: string; credential_id: string; user_id: string; alg: number; public_key: string
  sign_count: number; version: number; created_day: string
}

export type AuthPollRow = {
  id: string; ticket_hash: string; kind: 'add' | 'signin'; player_id: string | null; user_id: string | null
  challenge: string; state: 'pending' | 'added' | 'done'; version: number; expires_at: number
}

export type DropRow = {
  id: string; code_hash: string; code_plain: string | null; kind: string; reward_json: string
  supply: number | null; redeemed: number; per_account: number; bound: number
  starts_at: number; ends_at: number; created_at: number
}
export type RedemptionRow = { drop_id: string; player_id: string; day: string }
export type SeasonRow = { season: number; generator: number; species_json: string }
