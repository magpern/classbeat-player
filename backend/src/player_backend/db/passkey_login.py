"""Data access of passkey sign-in (ADR 0002, sections 4 and 10): calls of the `auth_*` functions.

No account is set here: these run before anyone is signed in. The challenge is in a closed
table, behind the functions. The signature is checked by the caller's `verify`, between the
look-up of the passkey and its use, inside the one transaction of the attempt.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import Literal

from player_backend.client_policy import ClientInfo
from player_backend.db.executor import Handle, Pool
from player_backend.db.queries import passkey_login as q

type SignInOutcome = Literal["signed_in", "refused", "limited", "busy"]
# Given the passkey's public key, the authenticator's counter when the signature checks out.
type Verify = Callable[[bytes], int | None]


class _Looked(Exception):
    """Leaves the savepoint of a look at a counter, which undoes that look's count."""


def new_challenge(
    pool: Pool,
    *,
    starts_key: bytes,
    starts_window: timedelta,
    starts_max: int,
    challenge_hash: bytes,
    browser_hash: bytes,
) -> bool:
    """Count one challenge start for the address, then store the challenge. False, with only
    the count written, when the address is over its limit (section 10)."""
    with pool.handle() as db, db.transaction():
        if _hit(db, starts_key, starts_window, starts_max):
            return False
        db.rows(q.NEW_CHALLENGE, (challenge_hash, browser_hash))
        return True


def _hit(db: Handle, key: bytes, window: timedelta, limit: int) -> bool:
    return db.rows(q.LIMIT_HIT, (key, window, limit))[0][0] is not False


def _over_already(db: Handle, key: bytes, window: timedelta, limit: int) -> bool:
    """Whether the counter is over its limit already, without counting this attempt.

    `rate_limit_hit` always counts, so the look is made in a savepoint that is undone unless
    it shows the limit passed: an attempt is counted only once it has failed.
    """
    try:
        with db.transaction():
            if _hit(db, key, window, limit):
                return True
            raise _Looked
    except _Looked:
        return False


def sign_in(
    pool: Pool,
    *,
    failed_key: bytes,
    failed_lock: tuple[int, int],
    failed_window: timedelta,
    failed_max: int,
    credential_id: bytes | None,
    challenge_hash: bytes | None,
    browser_hash: bytes,
    session_hash: bytes,
    client: ClientInfo,
    verify: Verify,
) -> SignInOutcome:
    """One passkey sign-in attempt.

    `limited` when the address has failed too often already. Otherwise every refusal is
    counted against the address and committed with it: one whose signature fails never
    reaches `auth_complete_passkey` and writes no event (section 4); one the function refuses
    has the event the function wrote. `credential_id` or `challenge_hash` is None when the
    credential named none the database could hold.

    The attempts of one address are taken one at a time under the advisory lock
    `failed_lock`, held from the check to the commit, so the check and the count are one step:
    of parallel failing attempts, no more pass the check than the limit leaves. An attempt that
    finds the lock taken is `busy` at once, with nothing read or written: it never waits for
    the lock on a pool connection.
    """
    with pool.handle() as db, db.transaction():
        if db.rows(q.TRY_LOCK_FAILED, failed_lock)[0][0] is not True:
            return "busy"
        if _over_already(db, failed_key, failed_window, failed_max):
            return "limited"
        done = False
        if credential_id is not None and challenge_hash is not None:
            found = db.rows(q.PASSKEY_FOR_LOGIN, (credential_id,))
            public_key = found[0][0] if len(found) == 1 else None
            counter = verify(public_key) if isinstance(public_key, bytes) else None
            if counter is not None:
                completed = db.rows(
                    q.COMPLETE_PASSKEY,
                    (
                        credential_id,
                        challenge_hash,
                        browser_hash,
                        counter,
                        session_hash,
                        client.network,
                        client.family,
                    ),
                )
                done = completed[0][0] is True
        if done:
            return "signed_in"
        _hit(db, failed_key, failed_window, failed_max)
        return "refused"
