-- Permanent, owner-free reservations: a named Mythic appears once, even if nobody catches it.
CREATE TABLE named_mythic_encounters (
  id TEXT PRIMARY KEY
) STRICT, WITHOUT ROWID;
