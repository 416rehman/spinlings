-- Trading without account limits, the market, challenges, global leaderboards and player stats (SPEC 8, 15,
-- 20, 24, 30). Expand only (SPEC 32): new columns with defaults, new tables and indexes. The previous release
-- reads none of them, and runs as it did on this schema.
--
-- Seasons in SQL: season n starts on 2026-10-01 + (n - 1) * 28 days (core/world.ts EPOCH_MS, SEASON_MS).

-- ---- no more trade locks (SPEC 8) --------------------------------------------------------------
-- Welcome cards and traded cards waited before they could trade again. Nothing waits now. Each owner's collection
-- version moves so the mod reads the cards again.
UPDATE players SET cards_version = cards_version + 1, version = version + 1
  WHERE id IN (SELECT owner_id FROM cards WHERE locked_until > 0);
UPDATE cards SET locked_until = 0, version = version + 1 WHERE locked_until > 0;
UPDATE packs SET lock_until = 0 WHERE lock_until > 0;

-- ---- leaderboards and stats (SPEC 8, 20) -------------------------------------------------------
-- Every player is on the leaderboards unless they hide, and hiding also takes their stats off their profile. The old
-- `leaderboard` opt-in column is no longer read (a later release drops it).
ALTER TABLE players ADD COLUMN board_hidden INTEGER NOT NULL DEFAULT 0 CHECK (board_hidden IN (0, 1));
-- All-time counts, public game numbers, never who and never when. duel_wins and duel_losses count duels against
-- players on either side, beaten counts distinct players beaten in a duel, species_count the rows in the album,
-- market_sales sales to distinct buyers.
ALTER TABLE players ADD COLUMN duel_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN duel_losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN beaten INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN wild_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN catches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN species_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN first_finds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN mythics_found INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN market_sales INTEGER NOT NULL DEFAULT 0;
-- This season's counts, for the season boards. They count for `stats_season` only: the first write of a new season
-- zeroes them (game/stats.ts), and the boards read them only where stats_season is the current season. s_species
-- counts this season's species in the album.
ALTER TABLE players ADD COLUMN stats_season INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN s_duel_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN s_beaten INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN s_species INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN s_mythics INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN s_sales INTEGER NOT NULL DEFAULT 0;

-- Which players each player has beaten in a duel, only to count them once each, never shown to anyone, and both
-- sides' rows go when either account is deleted. `season` is the last season the win came in.
CREATE TABLE beaten (
  player_id TEXT NOT NULL,
  other_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  PRIMARY KEY (player_id, other_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX beaten_other ON beaten (other_id);

-- The same for market sales: which buyers each seller has sold to, only so a sale counts once per buyer (two
-- accounts passing a card back and forth add nothing), never shown, and both sides' rows go when either account is
-- deleted. `season` is the last season a sale between them came in.
CREATE TABLE sold_to (
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  PRIMARY KEY (seller_id, buyer_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX sold_to_buyer ON sold_to (buyer_id);

-- Backfill what the database still knows. Battles are kept 7 days, so duel and wild counts start from those. Catches
-- count the caught cards still held, and a catch is a wild win too.
INSERT INTO beaten (player_id, other_id, season)
  SELECT winner, loser, MAX(season) FROM (
    SELECT CASE WHEN result = 'win' THEN attacker_id ELSE defender_id END AS winner,
           CASE WHEN result = 'win' THEN defender_id ELSE attacker_id END AS loser,
           CAST((julianday(settled) - julianday('2026-10-01')) / 28 AS INTEGER) + 1 AS season
    FROM battles
    WHERE kind = 'duel' AND state = 'settled' AND defender_id IS NOT NULL AND settled IS NOT NULL AND result IN ('win', 'loss')
  ) WHERE winner IN (SELECT id FROM players) AND loser IN (SELECT id FROM players)
  GROUP BY winner, loser;

UPDATE players SET
  duel_wins = (SELECT COUNT(*) FROM battles b WHERE b.kind = 'duel' AND b.state = 'settled' AND b.defender_id IS NOT NULL
    AND ((b.attacker_id = players.id AND b.result = 'win') OR (b.defender_id = players.id AND b.result = 'loss'))),
  duel_losses = (SELECT COUNT(*) FROM battles b WHERE b.kind = 'duel' AND b.state = 'settled' AND b.defender_id IS NOT NULL
    AND ((b.attacker_id = players.id AND b.result = 'loss') OR (b.defender_id = players.id AND b.result = 'win'))),
  beaten = (SELECT COUNT(*) FROM beaten x WHERE x.player_id = players.id),
  catches = (SELECT COUNT(*) FROM cards c WHERE c.owner_id = players.id AND c.origin = 'catch'),
  wild_wins = MAX(
    (SELECT COUNT(*) FROM battles b WHERE b.attacker_id = players.id AND b.kind = 'wild' AND b.state = 'settled' AND b.result = 'win'),
    (SELECT COUNT(*) FROM cards c WHERE c.owner_id = players.id AND c.origin = 'catch')),
  species_count = (SELECT COUNT(*) FROM album a WHERE a.player_id = players.id),
  first_finds = (SELECT COUNT(*) FROM firsts f WHERE f.player_id = players.id),
  mythics_found = (SELECT COUNT(*) FROM mythics m WHERE m.finder_id = players.id),
  -- the season counts are for the season of the player's last visit
  stats_season = season,
  s_duel_wins = (SELECT COUNT(*) FROM battles b WHERE b.kind = 'duel' AND b.state = 'settled' AND b.defender_id IS NOT NULL
    AND b.settled >= date('2026-10-01', '+' || ((players.season - 1) * 28) || ' days')
    AND b.settled < date('2026-10-01', '+' || (players.season * 28) || ' days')
    AND ((b.attacker_id = players.id AND b.result = 'win') OR (b.defender_id = players.id AND b.result = 'loss'))),
  s_beaten = (SELECT COUNT(*) FROM beaten x WHERE x.player_id = players.id AND x.season = players.season),
  s_species = (SELECT COUNT(*) FROM album a WHERE a.player_id = players.id AND a.species LIKE 's' || players.season || '-%'),
  s_mythics = (SELECT COUNT(*) FROM mythics m WHERE m.finder_id = players.id
    AND m.day >= date('2026-10-01', '+' || ((players.season - 1) * 28) || ' days')
    AND m.day < date('2026-10-01', '+' || (players.season * 28) || ' days')),
  version = version + 1;

-- Other players see these numbers, and the rating, as they stood at the last UTC midnight, so no counter shows
-- that someone is playing right now (SPEC 20.3). The first write of a day that moves one saves them all first as
-- JSON in pub_stats, with that day in pub_day; a row with no such write today still holds its midnight values, so
-- readers take pub_stats when pub_day is today and the columns otherwise (game/stats.ts). The boards read every
-- row that way, so they keep no index on the live columns.
ALTER TABLE players ADD COLUMN pub_day TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN pub_stats TEXT NOT NULL DEFAULT '{}';

-- Everyone hears once that the boards now show every player, and how to stay off them.
INSERT INTO notices (id, player_id, day, kind, text)
  SELECT lower(hex(randomblob(16))), id, date('now'), 'notice',
    'Leaderboards now show every player, with stats on profiles. To stay off them: /spin leaderboard off'
  FROM players;

-- ---- the market (SPEC 8) -----------------------------------------------------------------------
-- A listed card waits in escrow (cards.state 'escrow', escrow_ref = the listing id) until it sells, is cancelled
-- or lapses. The card's kind is copied here for the filters, and the card itself cannot change while it waits.
CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  seller_id TEXT NOT NULL,
  seller_handle TEXT NOT NULL,                  -- as it was when listed, so a later reroll never relabels it
  card_id TEXT NOT NULL,
  species TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('haiku', 'sonnet', 'opus', 'fable')),
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  shiny INTEGER NOT NULL CHECK (shiny IN (0, 1)),
  foil INTEGER NOT NULL CHECK (foil IN (0, 1)),
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0), -- sparks; 0 when it asks only for a card
  want TEXT,                                    -- JSON MarketWant, or NULL for sparks only
  kind TEXT NOT NULL CHECK (kind IN ('sparks', 'swap', 'both')),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'sold', 'cancelled', 'expired')),
  created TEXT NOT NULL,                        -- day
  expires TEXT NOT NULL,                        -- the day it lapses, the first midnight 14 days on
  resolved TEXT                                 -- day; closed listings are deleted 30 days later
) STRICT;
CREATE UNIQUE INDEX listings_card ON listings (card_id) WHERE state = 'open';
CREATE INDEX listings_seller ON listings (seller_id, state);
CREATE INDEX listings_newest ON listings (created, id) WHERE state = 'open';
CREATE INDEX listings_price ON listings (price, id) WHERE state = 'open';
CREATE INDEX listings_species ON listings (species, price) WHERE state = 'open';
CREATE INDEX listings_open ON listings (expires) WHERE state = 'open';
CREATE INDEX listings_resolved ON listings (resolved) WHERE state != 'open';

-- Recent sale prices per species, to help pricing: the day, the sparks and the card's kind, never who sold or
-- bought. Deleted after 90 days.
CREATE TABLE market_sales (
  id INTEGER PRIMARY KEY,
  species TEXT NOT NULL,
  rarity TEXT NOT NULL,
  shiny INTEGER NOT NULL CHECK (shiny IN (0, 1)),
  foil INTEGER NOT NULL CHECK (foil IN (0, 1)),
  price INTEGER NOT NULL CHECK (price >= 0),
  day TEXT NOT NULL
) STRICT;
CREATE INDEX market_sales_species ON market_sales (species, day);
CREATE INDEX market_sales_day ON market_sales (day);
