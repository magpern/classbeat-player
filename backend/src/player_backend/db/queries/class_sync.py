"""SQL of class sync as the player API reads it (player_backend/db/class_sync.py). Read only.
Every statement filters by the account in the code; the policy is the backstop (ADR 0002,
sections 7 and 9)."""

from typing import Final

from player_backend.db.executor import Query

# The account's current cursor. No row before its first publication: the cursor is then 0.
CURSOR: Final[Query] = Query(
    """
SELECT coalesce(
  (SELECT y.position FROM player.account_sync y WHERE y.account_id = %s), 0)
"""
)

# Section 7: the player API takes only rows with a number above 0. One more row than the page
# holds is asked for, as the sign that more follow. A class's content is not read here.
CHANGES: Final[Query] = Query(
    """
SELECT id, source_id, source_class_id, publication_number, kind, content_hash, published_at,
       sync_position
FROM player.classes
WHERE account_id = %s AND publication_number > 0 AND sync_position > %s
ORDER BY sync_position
LIMIT %s
"""
)

# One class that the account holds now. A removal's marker holds no document and is not found.
ONE_CLASS: Final[Query] = Query(
    """
SELECT source_id, source_class_id, publication_number, content_hash, sync_position, document
FROM player.classes
WHERE account_id = %s AND id = %s
  AND publication_number > 0 AND kind = 'class' AND document IS NOT NULL
"""
)
