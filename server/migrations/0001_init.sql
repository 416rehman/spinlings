-- Spinlings schema (SPEC sections 4-34). Applied by `wrangler d1 migrations apply` and by the Node
-- server at start. Once released, never edit a shipped migration: add the next NNNN_name.sql,
-- expand first and contract a release later (SPEC 32).
--
-- Conventions
--   * Days are 'YYYY-MM-DD' UTC strings. A full ms timestamp is kept only where a rule needs minutes
--     (spacing, locks, tiredness, expiries), never as activity history, and the sweep clears the
--     spacing marks once no rule reads them (SPEC 20.4).
--   * Every row a player can change has a `version`; handlers guard on it and bump it (SPEC 16).
--   * JSON columns hold the plugin/hooks/core/types.ts shapes named beside them.
--   * No foreign keys: deleting a player deletes its rows from every table explicitly, in one batch.
--   * Nothing here identifies a person: no IP, user agent, email, account, machine or timezone.

-- Every guarded batch inserts here. NULL (no row) or 0 aborts the batch, and the batch ends by
-- emptying the table again.
CREATE TABLE _guard (ok INTEGER NOT NULL CONSTRAINT guard_ok CHECK (ok = 1)) STRICT;

-- ---- players and their sessions (SPEC 27, 29, 30) ----------------------------------------------
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,                  -- server-generated adjective-creature-NN
  version INTEGER NOT NULL DEFAULT 0,
  joined TEXT NOT NULL,                         -- day
  last_seen TEXT NOT NULL,                      -- day
  handle_day TEXT NOT NULL DEFAULT '',          -- day of the last reroll, another after 7 days
  season INTEGER NOT NULL,                      -- season of the last touch: the season-end grant runs once
  sparks INTEGER NOT NULL DEFAULT 100 CHECK (sparks >= 0),
  rating INTEGER NOT NULL DEFAULT 1000 CHECK (rating >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  battles INTEGER NOT NULL DEFAULT 0,           -- finished battles: the trust gate and the gift bonus
  battle_day TEXT NOT NULL DEFAULT '',          -- day of the last finished battle
  battle_days INTEGER NOT NULL DEFAULT 0,       -- distinct days with a finished battle (gift bonus)
  wild_won INTEGER NOT NULL DEFAULT 0 CHECK (wild_won IN (0, 1)), -- beginner's luck: the first wild win catches
  leaderboard INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard IN (0, 1)), -- opt-in
  team TEXT NOT NULL DEFAULT '[]',              -- JSON card ids, slot order
  team_size INTEGER NOT NULL DEFAULT 0 CHECK (team_size BETWEEN 0 AND 3),
  cards_version INTEGER NOT NULL DEFAULT 0,     -- PlayerView.cardsVersion
  recent_opponents TEXT NOT NULL DEFAULT '[]',  -- JSON player ids (or 'rival') of the last 5 duels
  hello_day TEXT NOT NULL DEFAULT '',           -- day the daily hello was paid
  first_win_day TEXT NOT NULL DEFAULT '',       -- day the daily first-win pack was paid
  -- server pacing (SPEC 15, 24), the player's own view only; 0 once a day old (the sweep)
  last_wild_at INTEGER NOT NULL DEFAULT 0,      -- ms of the last wild start (spacing, rested bonus)
  last_duel_at INTEGER NOT NULL DEFAULT 0,      -- ms of the last duel start
  last_charge_at INTEGER NOT NULL DEFAULT 0,    -- ms of the last accepted pack charge (join counts as one)
  charges TEXT NOT NULL DEFAULT '[]',           -- JSON ms of accepted charges in the last 24 hours
  claim_hour INTEGER NOT NULL DEFAULT 0,        -- floor(ms / 1 h) of claim_tries (5 an hour)
  claim_tries INTEGER NOT NULL DEFAULT 0
) STRICT;
-- Matchmaking: WHERE team_size > 0 AND rating BETWEEN ? AND ? AND last_seen >= ?
CREATE INDEX players_match ON players (rating, last_seen) WHERE team_size > 0;
CREATE INDEX players_seen ON players (last_seen);
CREATE INDEX players_board ON players (rating DESC) WHERE leaderboard = 1;

-- One per device: possession of the token is identity.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,              -- sha256 of the bearer token
  created_day TEXT NOT NULL,                    -- day
  last_used_day TEXT NOT NULL                   -- day; unused for 180 days, the session expires
) STRICT;
CREATE INDEX sessions_player ON sessions (player_id);
CREATE INDEX sessions_idle ON sessions (last_used_day);

-- The only way to bring an account to another computer (SPEC 30).
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,           -- base64url
  user_id TEXT NOT NULL,                        -- base64url of the 16 random bytes given as user.id
  alg INTEGER NOT NULL CHECK (alg IN (-7, -257)), -- ES256 or RS256
  public_key TEXT NOT NULL,                     -- JSON JWK
  sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL                     -- day
) STRICT;
CREATE INDEX passkeys_player ON passkeys (player_id);

-- A passkey flow in progress (SPEC 29): the mod polls by pollId, the page acts by ticket. Both are
-- 128 random bits, stored hashed, single use and gone 10 minutes on. No token is ever stored: a
-- sign-in's session is made when the mod collects it.
CREATE TABLE auth_polls (
  id TEXT PRIMARY KEY,                          -- sha256 of the pollId
  ticket_hash TEXT NOT NULL UNIQUE,             -- sha256 of the page ticket
  kind TEXT NOT NULL CHECK (kind IN ('add', 'signin')),
  player_id TEXT,                               -- add: the account; signin: set once a passkey checks out
  user_id TEXT,                                 -- add: the user.id the new passkey is made with
  challenge TEXT NOT NULL,                      -- base64url WebAuthn challenge
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'added', 'done')),
  version INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL                   -- ms
) STRICT;
CREATE INDEX auth_polls_expiry ON auth_polls (expires_at);
CREATE INDEX auth_polls_player ON auth_polls (player_id) WHERE player_id IS NOT NULL;

-- ---- cards (SPEC 4, 18, 22, 32) ----------------------------------------------------------------
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  species TEXT NOT NULL,                        -- a species id, or 'fusion', 'mythic' or 'promo'
  form TEXT,                                    -- JSON CardForm, exactly for fusion, mythic and promo
  season INTEGER NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('haiku', 'sonnet', 'opus', 'fable')),
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  shiny INTEGER NOT NULL DEFAULT 0 CHECK (shiny IN (0, 1)),
  foil INTEGER NOT NULL DEFAULT 0 CHECK (foil IN (0, 1)),
  dna INTEGER NOT NULL CHECK (dna BETWEEN 0 AND 4294967295),
  genes TEXT NOT NULL,                          -- JSON Genes
  traits TEXT NOT NULL,                         -- JSON TraitId[]
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  stage INTEGER NOT NULL DEFAULT 1 CHECK (stage IN (1, 2, 3)),
  stats TEXT NOT NULL DEFAULT '{}',             -- JSON Stats, server-computed (SPEC 32)
  power INTEGER NOT NULL DEFAULT 0,             -- hp + 2 atk + 2 def + spd of stats
  bound INTEGER NOT NULL DEFAULT 0 CHECK (bound IN (0, 1)),
  for_trade INTEGER NOT NULL DEFAULT 0 CHECK (for_trade IN (0, 1)),
  origin TEXT NOT NULL,                         -- CardOrigin, how its current owner got it
  minted TEXT NOT NULL,                         -- day its current owner got it
  locked_until INTEGER NOT NULL DEFAULT 0,      -- ms; trade-locked until then
  tired_until INTEGER NOT NULL DEFAULT 0,       -- ms; tired until then
  state TEXT NOT NULL DEFAULT 'owned' CHECK (state IN ('owned', 'escrow')),
  escrow_ref TEXT,                              -- the offer id or gift code holding it
  first_find INTEGER NOT NULL DEFAULT 0 CHECK (first_find IN (0, 1)),
  -- raised forms (SPEC 18): battles fought per arena family under its current owner, hidden from
  -- everyone; raised_in is fixed at the first evolution and never shown to anyone else
  arena_haiku INTEGER NOT NULL DEFAULT 0,
  arena_sonnet INTEGER NOT NULL DEFAULT 0,
  arena_opus INTEGER NOT NULL DEFAULT 0,
  arena_fable INTEGER NOT NULL DEFAULT 0,
  raised_in TEXT CHECK (raised_in IN ('haiku', 'sonnet', 'opus', 'fable'))
) STRICT;
-- The collection, and auto-fill of tired slots by the highest power
CREATE INDEX cards_owner ON cards (owner_id, power DESC);
-- Trade board matches: WHERE for_trade = 1 AND species = ?
CREATE INDEX cards_for_trade ON cards (species, owner_id) WHERE for_trade = 1;
-- Trade board listings from a random id onwards: WHERE id >= ? AND for_trade = 1 ORDER BY id
CREATE INDEX cards_market ON cards (id) WHERE for_trade = 1;
CREATE INDEX cards_escrow ON cards (escrow_ref) WHERE escrow_ref IS NOT NULL;

-- Species a player has ever owned (the album).
CREATE TABLE album (
  player_id TEXT NOT NULL,
  species TEXT NOT NULL,
  PRIMARY KEY (player_id, species)
) STRICT, WITHOUT ROWID;

CREATE TABLE wishes (
  player_id TEXT NOT NULL,
  species TEXT NOT NULL,
  pos INTEGER NOT NULL,
  PRIMARY KEY (player_id, species)
) STRICT, WITHOUT ROWID;
CREATE INDEX wishes_species ON wishes (species, player_id);

-- The Fusion Log keeps the hybrid's form even after the card is traded or recycled.
CREATE TABLE fusions (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL,
  form TEXT NOT NULL,                           -- JSON Form & { parents }
  day TEXT NOT NULL
) STRICT;
CREATE INDEX fusions_player ON fusions (player_id);

-- Unopened packs only: cards are rolled when a pack opens, and opening deletes the row. The pack's
-- family (the model family of a charge) lives no longer than this row (SPEC 20.2).
CREATE TABLE packs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('haiku', 'sonnet', 'opus', 'fable')),
  source TEXT NOT NULL,                         -- PackView source
  created TEXT NOT NULL,                        -- day
  lock_until INTEGER NOT NULL DEFAULT 0,        -- ms; the cards it opens are trade-locked until then (welcome packs)
  bound INTEGER NOT NULL DEFAULT 0 CHECK (bound IN (0, 1)) -- a bound drop's packs open bound cards
) STRICT;
CREATE INDEX packs_owner ON packs (owner_id);

-- ---- battles (SPEC 5, 15, 32): deleted 7 days after settling, which also forgets the arena -----
CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  attacker_id TEXT NOT NULL,
  defender_id TEXT,                             -- the defending player; NULL for wild and rival battles
  kind TEXT NOT NULL CHECK (kind IN ('wild', 'duel', 'rival')),
  version INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'settled')),
  setup TEXT NOT NULL,                          -- JSON BattleSetup, emptied at settling
  opponent TEXT NOT NULL,                       -- JSON opponent at match time, emptied at settling
  rules INTEGER NOT NULL DEFAULT 1,             -- the rules version it settles with (SPEC 32)
  started_at INTEGER NOT NULL,                  -- ms; abandoned after 10 minutes
  finish_after INTEGER NOT NULL DEFAULT 0,      -- ms; the earliest finish (SPEC 15)
  revenge INTEGER NOT NULL DEFAULT 0 CHECK (revenge IN (0, 1)),
  settled TEXT,                                 -- day
  result TEXT CHECK (result IN ('win', 'loss', 'draw')),
  outcome TEXT,                                 -- JSON FinishBattleResponse of a finish, answered again to a retry
  catch_options TEXT,                           -- JSON BattleCard[] while a catch is pending
  catch_until INTEGER NOT NULL DEFAULT 0        -- ms
) STRICT;
CREATE INDEX battles_attacker ON battles (attacker_id, started_at);
CREATE INDEX battles_defender ON battles (defender_id) WHERE defender_id IS NOT NULL;
CREATE INDEX battles_open ON battles (started_at) WHERE state = 'open';
CREATE INDEX battles_settled ON battles (settled) WHERE state = 'settled';
-- The pair limit: duels between two accounts in the last 24 hours, by started_at
CREATE INDEX battles_pair ON battles (attacker_id, defender_id, started_at) WHERE defender_id IS NOT NULL;

-- ---- trading (SPEC 8) --------------------------------------------------------------------------
CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  -- both handles as they were when it was sent, so a later reroll never relabels it (SPEC 20.1)
  from_handle TEXT NOT NULL,
  to_handle TEXT NOT NULL,
  give TEXT NOT NULL,                           -- JSON card ids from from_id (escrowed)
  get TEXT NOT NULL,                            -- JSON card ids requested from to_id
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'accepted', 'declined', 'cancelled', 'expired')),
  created TEXT NOT NULL,                        -- day
  expires_at INTEGER NOT NULL,                  -- ms, the first midnight 72 hours on
  resolved TEXT                                 -- day; resolved offers are deleted 30 days later
) STRICT;
CREATE INDEX offers_to ON offers (to_id, state);
CREATE INDEX offers_from ON offers (from_id, state);
CREATE INDEX offers_open ON offers (expires_at) WHERE state = 'open';
CREATE INDEX offers_resolved ON offers (resolved) WHERE state != 'open';

CREATE TABLE gifts (
  code TEXT PRIMARY KEY,                        -- word-word-word-dddd, about 44 bits, single use
  version INTEGER NOT NULL DEFAULT 0,
  giver_id TEXT NOT NULL,
  card_id TEXT NOT NULL,                        -- escrowed while open
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'claimed', 'cancelled', 'returned')),
  created TEXT NOT NULL,                        -- day
  expires TEXT NOT NULL,                        -- the day it lapses, 14 days on
  claimed_by TEXT,                              -- player id
  resolved TEXT,                                -- day; resolved gifts are deleted 30 days later
  bonus INTEGER NOT NULL DEFAULT 0 CHECK (bonus IN (0, 1, 2)) -- the giver's bonus pack: 0 none, 1 waiting, 2 paid
) STRICT;
CREATE INDEX gifts_giver ON gifts (giver_id, state);
CREATE INDEX gifts_open ON gifts (expires) WHERE state = 'open';
CREATE INDEX gifts_resolved ON gifts (resolved) WHERE state != 'open';
CREATE INDEX gifts_claimant ON gifts (claimed_by) WHERE claimed_by IS NOT NULL;

-- Deleted after 30 days. Shown as "today" or "yesterday", never as a time (SPEC 20.3).
CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,                           -- composed from fixed templates, naming nobody
  other_id TEXT,                                -- the other player, shown by handle; NULL once they reroll or leave
  revenge_until INTEGER                         -- ms; set on defense-loss notices until the revenge is used
) STRICT;
CREATE INDEX notices_player ON notices (player_id, day);
CREATE INDEX notices_day ON notices (day);
CREATE INDEX notices_other ON notices (other_id) WHERE other_id IS NOT NULL;

-- ---- the world's records -----------------------------------------------------------------------
-- First discoveries (SPEC 13): the first card of each species anyone obtained in its season. The row
-- outlives its finder's account (player_id goes NULL), so nobody else can become first.
CREATE TABLE firsts (
  species TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  player_id TEXT,
  card_id TEXT NOT NULL,
  day TEXT NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX firsts_player ON firsts (player_id);

-- The public "Mythics found" list (SPEC 18): handle and name only.
CREATE TABLE mythics (
  card_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  finder_id TEXT,                               -- NULL once the finder deletes their account
  handle TEXT,                                  -- the finder's handle at the catch; NULL once they reroll or leave
  day TEXT NOT NULL
) STRICT;
CREATE INDEX mythics_day ON mythics (day);
CREATE INDEX mythics_finder ON mythics (finder_id);

-- The Wandering Trader (SPEC 19): each deal once per day per player. Rows go after their day.
CREATE TABLE trader_uses (
  player_id TEXT NOT NULL,
  day TEXT NOT NULL,
  deal INTEGER NOT NULL CHECK (deal BETWEEN 0 AND 2),
  PRIMARY KEY (player_id, day, deal)
) STRICT, WITHOUT ROWID;
CREATE INDEX trader_uses_day ON trader_uses (day);

-- Handles of deleted accounts (and rerolled ones) stay taken until `until` (SPEC 20.7).
CREATE TABLE retired_handles (
  handle TEXT PRIMARY KEY,
  until TEXT NOT NULL                           -- day
) STRICT, WITHOUT ROWID;
CREATE INDEX retired_handles_until ON retired_handles (until);

-- ---- drops (SPEC 25): data, not code, written only by scripts/admin/drop.ts --------------------
CREATE TABLE drops (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,               -- sha256 hex of normalizeDropCode(code)
  code_plain TEXT UNIQUE,                       -- public vanity codes only (normalised); NULL for unique codes
  kind TEXT NOT NULL,                           -- e.g. public, unique, creator
  reward_json TEXT NOT NULL,                    -- JSON DropReward, checked by dropRewardSchema
  supply INTEGER CHECK (supply IS NULL OR supply >= 0),
  redeemed INTEGER NOT NULL DEFAULT 0 CHECK (supply IS NULL OR redeemed <= supply),
  per_account INTEGER NOT NULL DEFAULT 1,
  bound INTEGER NOT NULL DEFAULT 1 CHECK (bound IN (0, 1)),
  starts_at INTEGER NOT NULL,                   -- ms
  ends_at INTEGER NOT NULL,                     -- ms
  created_at INTEGER NOT NULL                   -- ms
) STRICT;

-- Who redeemed what is never shown to anyone, only counts; deleted with the player.
CREATE TABLE redemptions (
  drop_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (drop_id, player_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX redemptions_player ON redemptions (player_id);

-- Frozen seasons (SPEC 32): each season's 36 species, generated once, served forever.
CREATE TABLE seasons (
  season INTEGER PRIMARY KEY,
  generator INTEGER NOT NULL,                   -- GENERATOR_VERSION that made them
  species_json TEXT NOT NULL                    -- JSON Species[36]
) STRICT;

-- ---- abuse limits (SPEC 11, 15, 20.5) ----------------------------------------------------------
-- Join proof-of-work challenges: single use, 5-minute expiry, deleted on use or expiry.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  difficulty INTEGER NOT NULL,
  expires_at INTEGER NOT NULL                   -- ms
) STRICT, WITHOUT ROWID;
CREATE INDEX challenges_expiry ON challenges (expires_at);

-- Challenges, joins, sign-in starts and drop redemptions counted per key and hour, where key =
-- HMAC(SECRET, day + ip) cut to 16 bytes, never the address. Rows are deleted 24 hours after their hour.
CREATE TABLE join_counters (
  key TEXT NOT NULL,
  hour INTEGER NOT NULL,                        -- floor(ms / 1 h)
  challenges INTEGER NOT NULL DEFAULT 0,
  joins INTEGER NOT NULL DEFAULT 0,
  auth INTEGER NOT NULL DEFAULT 0,
  redeem INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, hour)
) STRICT, WITHOUT ROWID;
CREATE INDEX join_counters_hour ON join_counters (hour);
