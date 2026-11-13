"""SQL of the class library as the site reads and deletes it (player_backend/db/library.py).
Every statement filters by the account in the code; the policy is the backstop (ADR 0002,
sections 7, 9 and 12)."""

from typing import Final

from player_backend.db.executor import Query

# The list: rows with a number above 0, the latest change first. Only the title and the length
# are read of a document. The place bound is given twice: null means from the latest. One more
# row than the page holds is asked for, as the sign that more follow.
LIST_CLASSES: Final[Query] = Query(
    """
SELECT id, source_id, source_class_id, publication_number, kind = 'removal', published_at,
       sync_position, document -> 'class' -> 'title', document -> 'class' -> 'length_ms'
FROM player.classes
WHERE account_id = %s AND publication_number > 0
  AND (%s::bigint IS NULL OR sync_position < %s::bigint)
ORDER BY sync_position DESC
LIMIT %s
"""
)

# One class the account holds now, with its document. A marker is not found.
READ_CLASS: Final[Query] = Query(
    """
SELECT source_id, source_class_id, publication_number, content_hash, published_at, document
FROM player.classes
WHERE account_id = %s AND id = %s
  AND publication_number > 0 AND kind = 'class' AND document IS NOT NULL
"""
)

# The row a deletion acts on, locked until the transaction ends: a publication of the same
# class waits for it, and it for the publication (classes.LOCK_CLASS takes the same lock first).
LOCK_FOR_DELETE: Final[Query] = Query(
    """
SELECT kind, source_id, source_class_id, publication_number
FROM player.classes
WHERE account_id = %s AND id = %s AND publication_number > 0
FOR UPDATE
"""
)

# ADR 0002, sections 7 and 12: the same marker as a removal, at the highest number seen. The
# document and its hash go at once; the row keeps its key and number and takes a new place.
MARK_DELETED: Final[Query] = Query(
    """
UPDATE player.classes
SET kind = 'removal', content_hash = NULL, document = NULL, published_at = now(),
    sync_position = %s
WHERE account_id = %s AND id = %s AND kind = 'class'
RETURNING id
"""
)

# Section 11: "class deleted on the site". The acting credential is the site session.
ADD_LIBRARY_EVENT: Final[Query] = Query(
    """
INSERT INTO player.audit_events
  (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
VALUES (%s, %s, %s, %s, %s::cidr, %s, %s::jsonb)
"""
)
