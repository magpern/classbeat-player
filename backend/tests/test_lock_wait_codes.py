"""Only a lock wait that ran out counts as one (#163; ADR 0002, section 10).

`lock_wait.ran_out` turns PostgreSQL's `lock_not_available` (55P03) into a 429 the client may
retry. Every other failure must propagate as it is: a deadlock, a cancelled or timed-out
statement, a broken constraint, an aborted transaction, or an error with no code at all.
"""

from __future__ import annotations

import pytest

from player_backend.db.executor import DatabaseError
from player_backend.db.lock_wait import LOCK_NOT_AVAILABLE, ran_out


def test_the_code_is_postgresqls_lock_not_available() -> None:
    assert LOCK_NOT_AVAILABLE == "55P03"


@pytest.mark.parametrize(
    ("sqlstate", "expected"),
    [
        ("55P03", True),  # lock_not_available: the lock_timeout ran out
        ("40P01", False),  # deadlock_detected
        ("57014", False),  # query_canceled, also statement_timeout
        ("23505", False),  # unique_violation
        ("25P02", False),  # in_failed_sql_transaction
        ("55006", False),  # object_in_use, same class as 55P03
        ("55000", False),  # object_not_in_prerequisite_state, same class
        ("55p03", False),  # a code is compared exactly
        ("", False),
        (None, False),  # no code: no connection, wrong number of parameters
    ],
)
def test_only_55p03_is_a_lock_wait_that_ran_out(sqlstate: str | None, expected: bool) -> None:
    assert ran_out(DatabaseError("failed", sqlstate)) is expected
