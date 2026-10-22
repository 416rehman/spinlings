-- Public first-discovery credit belongs to the handle used for that find. A later rename never
-- joins an old identity to a new one. Same-day historical renames are ambiguous, so stay unnamed.
ALTER TABLE firsts ADD COLUMN handle TEXT;

UPDATE firsts SET handle = (
  SELECT p.handle FROM players p WHERE p.id = firsts.player_id
    AND (p.handle_day = '' OR p.handle_day < firsts.day)
);

CREATE INDEX cards_species_owner ON cards (species, owner_id);
CREATE INDEX mythics_name ON mythics (lower(name), card_id);

-- Keep the same privacy boundary while the previous Worker runs during deployment or rollback.
-- Older inserts omit the nullable column; older renames/deletes know only the existing fields.
CREATE TRIGGER firsts_name_insert AFTER INSERT ON firsts WHEN NEW.handle IS NULL AND NEW.player_id IS NOT NULL BEGIN UPDATE firsts SET handle = (SELECT handle FROM players WHERE id = NEW.player_id) WHERE species = NEW.species; END;
CREATE TRIGGER firsts_forget_rename AFTER UPDATE OF handle ON players WHEN OLD.handle != NEW.handle BEGIN UPDATE firsts SET handle = NULL WHERE player_id = OLD.id; END;
CREATE TRIGGER firsts_forget_delete AFTER UPDATE OF player_id ON firsts WHEN NEW.player_id IS NULL BEGIN UPDATE firsts SET handle = NULL WHERE species = NEW.species; END;
