-- The hourly sweep turns a trade lock or tiredness that has passed back to 0, so a card keeps no
-- exact time once no rule reads it (SPEC 20.4), and does the same for a battle's catch window and
-- duel start and a defense loss's revenge window. These partial indexes hold only the rows with one
-- set, so the sweep never walks a whole table. Expand only: the previous release ignores them.
CREATE INDEX cards_locked ON cards (locked_until) WHERE locked_until > 0;
CREATE INDEX cards_tired ON cards (tired_until) WHERE tired_until > 0;
CREATE INDEX battles_catch ON battles (catch_until) WHERE catch_until > 0;
CREATE INDEX battles_started ON battles (started_at) WHERE state = 'settled' AND started_at > 0;
CREATE INDEX notices_revenge ON notices (revenge_until) WHERE revenge_until IS NOT NULL;
