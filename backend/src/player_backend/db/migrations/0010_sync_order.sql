-- ADR 0002, section 7: the account's sync order, made safer to page and bound to its account.
-- Additive only: one index, one column and two checks. No function, no grant, no policy and no
-- limit changes (principle 7), so the guard tests read the functions back unchanged.

-- A place in one account's sync order is unique. The per-account cursor, locked by each applied
-- publication and each deletion, already makes it so; the index states it and serves the
-- paging of `/api/player/changes`, the site's class list and the export. A placeholder
-- (number 0) has no place, and NULLs do not collide.
CREATE UNIQUE INDEX classes_account_sync_position
  ON player.classes (account_id, sync_position);

-- The start of the account's sync order. The backend picks it at random when it makes the row
-- (sync_policy.py), so the places of two accounts do not overlap and a cursor of one account is
-- not a place of another. Rows made before this migration start at 0, as they always did.
ALTER TABLE player.account_sync
  ADD COLUMN base bigint NOT NULL DEFAULT 0 CHECK (base >= 0);
ALTER TABLE player.account_sync
  ADD CONSTRAINT account_sync_position_from_base CHECK (position >= base);
