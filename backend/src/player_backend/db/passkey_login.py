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

type SignInOutcome = Literal["signed_in", "refused", "limited"]
# Given the passkey's public key, the authenticator's counter when the signature checks out.
type Verify = Callable[[bytes], int | None]


class _Looked(Exception):
    """Leaves the savepoint of a look at a counter, which undoes that look's count."""


def new_challenge(pool: Pool, *, challenge_hash: bytes, browser_hash: bytes) -> None:
    with pool.handle() as db, db.transaction():
        db.rows(q.NEW_CHALLENGE, (challenge_hash, browser_hash))


def _hit(db: Handle, key: bytes, window: timedelta, limit: int) -> bool:
    return db.rows(q.FAILED_LIMIT_HIT, (key, window, limit))[0][0] is not False


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
    """
    with pool.handle() as db, db.transaction():
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
