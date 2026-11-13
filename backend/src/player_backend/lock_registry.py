"""Every advisory lock the backend takes, in one list (ADR 0002, sections 4, 5, 6, 7 and 10).

Two kinds, which PostgreSQL keeps apart (`pg_locks.objsubid` 2 and 1):

- Two keys: a number below, and 32 bits of what is locked (an account id, or a hash). Two
  things that share those bits only wait for each other.
- One key: the migration runner's number, and `hashtextextended(<prefix> || <account>, 0)`
  for the prefixes below.

The SQL holds the numbers and prefixes as literals (a query is one string literal); the tests
check that the SQL, the Python callers and this list agree, and that no number or prefix is
used twice. Pure: no I/O.
"""

from __future__ import annotations

from typing import Final

# One key: one migration run at a time (db/queries/migrations.py).
MIGRATIONS: Final = 7270001
# Two keys: link requests for one email from one browser (migration 0005).
SIGN_IN_LINK: Final = 7270002
# Two keys: new sessions of one account, under the cap of 20 (migrations 0005 and 0011).
ACCOUNT_SESSIONS: Final = 7270003
# Two keys: passkey additions of one account, under the cap of 10 (db/queries/passkeys.py).
PASSKEY_ADDITIONS: Final = 7270011
# Two keys: failed passkey sign-ins of one address, from the check to the commit. Taken with
# `pg_try_advisory_xact_lock` and passed as a parameter (db/passkey_login.py).
PASSKEY_FAILED: Final = 7270012

NUMBERS: Final[dict[str, int]] = {
    "MIGRATIONS": MIGRATIONS,
    "SIGN_IN_LINK": SIGN_IN_LINK,
    "ACCOUNT_SESSIONS": ACCOUNT_SESSIONS,
    "PASSKEY_ADDITIONS": PASSKEY_ADDITIONS,
    "PASSKEY_FAILED": PASSKEY_FAILED,
}

# The numbers no SQL text names: the caller passes them.
PASSED_AS_PARAMETER: Final[frozenset[int]] = frozenset({PASSKEY_FAILED})

# One key each, hashed with the account id: an account's pairing codes (migrations 0006 and
# 0007) and its source links (migration 0008).
HASHED_PREFIXES: Final[tuple[str, ...]] = ("pairing.codes:", "source.links:")
