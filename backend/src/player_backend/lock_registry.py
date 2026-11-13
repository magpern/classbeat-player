"""Every advisory lock the backend takes, in one list (ADR 0002, sections 4, 5, 6, 7 and 10).

Two kinds, which PostgreSQL keeps apart (`pg_locks.objsubid` 2 and 1):

- Two keys: a number below, and 32 bits of what is locked (an account id, or a hash). Two
  things that share those bits only wait for each other.
- One key (a bigint): the migration runner's number; `hashtextextended(<prefix> || <account>,
  0)` for the prefixes below; and the keys a caller passes, 64 bits of a hash of its own.

The SQL holds the numbers and prefixes as literals (a query is one string literal). `SITES`
names every place each lock is taken, once per call, and the tests check the SQL against it:
no lock outside the list, none at a place the list does not name, no number or prefix twice.
Pure: no I/O.
"""

from __future__ import annotations

from typing import Final

# One key: one migration run at a time.
MIGRATIONS: Final = 7270001
# Two keys: link requests for one email from one browser.
SIGN_IN_LINK: Final = 7270002
# Two keys: new sessions of one account, under the cap of 20. Waited for at most 2 seconds.
ACCOUNT_SESSIONS: Final = 7270003
# Two keys: passkey additions of one account, under the cap of 10. Waited for at most 2
# seconds (`passkey_policy.ADDITIONS_LOCK_WAIT`).
PASSKEY_ADDITIONS: Final = 7270011

NUMBERS: Final[dict[str, int]] = {
    "MIGRATIONS": MIGRATIONS,
    "SIGN_IN_LINK": SIGN_IN_LINK,
    "ACCOUNT_SESSIONS": ACCOUNT_SESSIONS,
    "PASSKEY_ADDITIONS": PASSKEY_ADDITIONS,
}

# Numbers once used and never to be used again: 7270012 was the two-key lock of failed passkey
# sign-ins, now the one-key `PASSKEY_FAILED` below (#146).
RETIRED: Final[frozenset[int]] = frozenset({7270012})

# One key each, hashed with the account id: an account's pairing codes and its source links.
PAIRING_CODES: Final = "pairing.codes:"
SOURCE_LINKS: Final = "source.links:"
HASHED_PREFIXES: Final[tuple[str, ...]] = (PAIRING_CODES, SOURCE_LINKS)

# One key, passed by the caller as a parameter: failed passkey sign-ins of one address, 64 bits
# of the counter's key (`passkey_policy.failed_lock_key`), taken with `pg_try_advisory_xact_lock`.
PASSKEY_FAILED: Final = "passkey.failed"
PARAMETER_KEYS: Final[tuple[str, ...]] = (PASSKEY_FAILED,)

_MIGRATION_DIR: Final = "db/migrations/"
# Where each lock is taken, relative to the package: one entry per call.
SITES: Final[dict[int | str, tuple[str, ...]]] = {
    MIGRATIONS: ("db/queries/migrations.py",),
    SIGN_IN_LINK: (_MIGRATION_DIR + "0005_sign_in_hardening.sql",),
    ACCOUNT_SESSIONS: (
        _MIGRATION_DIR + "0005_sign_in_hardening.sql",
        _MIGRATION_DIR + "0011_passkeys.sql",
        # Both again, their bodies replaced with the wait bounded (#158).
        _MIGRATION_DIR + "0012_bounded_lock_waits.sql",
        _MIGRATION_DIR + "0012_bounded_lock_waits.sql",
    ),
    PASSKEY_ADDITIONS: ("db/queries/passkeys.py",),
    PAIRING_CODES: (
        _MIGRATION_DIR + "0006_pairing_and_devices.sql",
        _MIGRATION_DIR + "0006_pairing_and_devices.sql",
        _MIGRATION_DIR + "0007_pairing_hardening.sql",
    ),
    SOURCE_LINKS: (_MIGRATION_DIR + "0008_source_api.sql",),
    PASSKEY_FAILED: ("db/queries/passkey_login.py",),
}
