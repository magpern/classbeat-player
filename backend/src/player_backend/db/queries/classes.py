"""SQL of the class library as sources write it (player_backend/db/classes.py). Every statement
filters by the account in the code; the policy is the backstop (ADR 0002, sections 7 and 9)."""

from typing import Final

from player_backend.db.executor import Query

# Section 7: a first publication has a row to lock too. Number 0 is the placeholder; it is never
# committed, because a refusal rolls it back.
PLACEHOLDER: Final[Query] = Query(
    """
INSERT INTO player.classes (account_id, source_id, source_class_id, publication_number)
VALUES (%s, %s, %s, 0)
ON CONFLICT (account_id, source_id, source_class_id) DO NOTHING
"""
)

# The class row, locked until the transaction ends: two sends of one class never cross.
LOCK_CLASS: Final[Query] = Query(
    """
SELECT id, publication_number, kind, content_hash, document IS NOT NULL
FROM player.classes
WHERE account_id = %s AND source_id = %s AND source_class_id = %s
FOR UPDATE
"""
)

# The sync cursor: one row per account, made at its first publication. The update locks it,
# so one account's changes get their numbers in the order they commit.
SYNC_ROW: Final[Query] = Query(
    """
INSERT INTO player.account_sync (account_id) VALUES (%s)
ON CONFLICT (account_id) DO NOTHING
"""
)
SYNC_NEXT: Final[Query] = Query(
    """
UPDATE player.account_sync SET position = position + 1
WHERE account_id = %s
RETURNING position
"""
)

# Section 7: the count of 2,000 takes only rows that hold a document.
COUNT_HELD: Final[Query] = Query(
    "SELECT count(*) FROM player.classes WHERE account_id = %s AND document IS NOT NULL"
)

# An applied publication. A removal stores no hash and no document: the row is the marker.
APPLY: Final[Query] = Query(
    """
UPDATE player.classes
SET publication_number = %s, kind = %s, content_hash = %s, published_at = now(),
    sync_position = %s, document = %s::jsonb
WHERE account_id = %s AND id = %s
"""
)

# What a source may read of its own class: the highest number seen and its kind. No content.
HIGHEST: Final[Query] = Query(
    """
SELECT publication_number, kind
FROM player.classes
WHERE account_id = %s AND source_id = %s AND source_class_id = %s AND publication_number > 0
"""
)
