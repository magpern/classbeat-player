"""Data access of email link sign-in (ADR 0002, section 4): calls of the `auth_*` functions.

No account is set here: these run before anyone is signed in, and everything they touch is in
the closed tables, behind the functions.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Literal

from player_backend.client_policy import ClientInfo
from player_backend.db.executor import DatabaseError, Pool
from player_backend.db.lock_wait import ran_out
from player_backend.db.queries import login as q

type LinkOutcome = Literal["limited", "invalid", "mail", "no_mail"]
type CompleteOutcome = Literal["signed_in", "refused", "busy"]


def request_link(
    pool: Pool,
    *,
    address_key: bytes,
    address_window: timedelta,
    address_max: int,
    email: str | None,
    link_hash: bytes,
    browser_hash: bytes,
    address_hash: bytes,
    client: ClientInfo,
) -> LinkOutcome:
    """Count the requester's own limit, then make the one sign-in call.

    `limited` is the only outcome that depends on the requester alone. `mail` and `no_mail`
    must look the same to them. `email` is None when the input is not valid (what was typed is
    not an address, or the return entry is not one): then the sign-in call is not made.
    """
    with pool.handle() as db, db.transaction():
        over = db.rows(q.ADDRESS_LIMIT_HIT, (address_key, address_window, address_max))
        if over[0][0] is not False:
            return "limited"
        if email is None:
            return "invalid"
        sent = db.rows(
            q.REQUEST_LOGIN,
            (email, link_hash, browser_hash, address_hash, client.network, client.family),
        )
        return "mail" if sent[0][0] is True else "no_mail"


def complete(
    pool: Pool, *, link_hash: bytes, browser_hash: bytes, session_hash: bytes, client: ClientInfo
) -> CompleteOutcome:
    """Use a link up and create the session: `signed_in` only when the function said so.

    `busy` when the function's wait for the account's sign-in lock ran out (#158): the whole
    call is rolled back, so the link is not used up and nothing is written.
    """
    try:
        with pool.handle() as db, db.transaction():
            done = db.rows(
                q.COMPLETE_LOGIN,
                (link_hash, browser_hash, session_hash, client.network, client.family),
            )
    except DatabaseError as error:
        if not ran_out(error):
            raise
        return "busy"
    return "signed_in" if done[0][0] is True else "refused"
