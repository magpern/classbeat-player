"""`purge_expired` rolls the purge back when `auth_purge_expired()` reports anything but the
fixed kinds with a non-negative count each (#742, #744): both checks run inside the purge's
transaction, so a report they refuse leaves every row in place."""

from __future__ import annotations

import secrets
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from typing import cast

import psycopg
import pytest

from player_backend.db.executor import Handle, Params, Query, Row
from player_backend.db.operator import PURGE_KINDS, UnexpectedPurgeReport, purge_expired
from player_backend.db.queries import operator as q

Tamper = Callable[[list[Row]], list[Row]]


def _renamed(rows: list[Row]) -> list[Row]:
    return [("accounts", rows[0][1]), *rows[1:]]


def _dropped(rows: list[Row]) -> list[Row]:
    return rows[:-1]


def _swapped(rows: list[Row]) -> list[Row]:
    return [rows[1], rows[0], *rows[2:]]


def _no_count(rows: list[Row]) -> list[Row]:
    return [(rows[0][0], None), *rows[1:]]


def _negative(rows: list[Row]) -> list[Row]:
    return [(rows[0][0], -1), *rows[1:]]


def _not_an_int(rows: list[Row]) -> list[Row]:
    return [(rows[0][0], 1.0), (rows[1][0], True), *rows[2:]]


def _no_kind(rows: list[Row]) -> list[Row]:
    return [(None, rows[0][1]), *rows[1:]]


# The kind check refuses the first three, the count check the next three (with the kind check
# gone, each still fails); the last is refused by either.
TAMPERS: dict[str, Tamper] = {
    "unexpected kind": _renamed,
    "missing kind": _dropped,
    "kinds out of order": _swapped,
    "missing count": _no_count,
    "negative count": _negative,
    "count not an int": _not_an_int,
    "kind not a string": _no_kind,
}


class _Tampered:
    """Stands for a handle: the purge's report goes through `tamper`, everything else through
    `inner` (a real handle, or None for the fake report of `FAKE_REPORT`)."""

    def __init__(self, inner: Handle | None, tamper: Tamper) -> None:
        self.inner, self.tamper = inner, tamper
        self.outcomes: list[str] = []

    def rows(self, query: Query, params: Params | None = None, /) -> list[Row]:
        assert query is q.PURGE_EXPIRED
        rows = FAKE_REPORT if self.inner is None else self.inner.rows(query, params)
        return self.tamper(list(rows))

    @contextmanager
    def _fake_transaction(self) -> Generator[None]:
        try:
            yield
        except BaseException:
            self.outcomes.append("rolled back")
            raise
        self.outcomes.append("committed")

    def transaction(self) -> object:
        return self._fake_transaction() if self.inner is None else self.inner.transaction()


FAKE_REPORT: list[Row] = [(kind, n) for n, kind in enumerate(PURGE_KINDS)]


@pytest.mark.parametrize("tamper", TAMPERS.values(), ids=TAMPERS.keys())
def test_a_refused_report_raises_inside_the_transaction(tamper: Tamper) -> None:
    fake = _Tampered(None, tamper)
    with pytest.raises(UnexpectedPurgeReport) as raised:
        purge_expired(cast(Handle, fake))
    assert fake.outcomes == ["rolled back"]
    assert "accounts" not in str(raised.value) and "None" not in str(raised.value)


def test_the_fixed_report_is_committed_and_returned() -> None:
    fake = _Tampered(None, lambda rows: rows)
    assert purge_expired(cast(Handle, fake)) == FAKE_REPORT
    assert fake.outcomes == ["committed"]


@pytest.fixture
def expired_row(db_url: str) -> Iterator[bytes]:
    """A committed rate-limit row past its time, which a purge that went through removes."""
    key = secrets.token_bytes(32)
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO player.rate_limits (key_hash, window_start, hits, expires_at) "
            "VALUES (%s, now(), 1, now() - interval '1 minute')",
            (key,),
        )
    yield key
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("DELETE FROM player.rate_limits WHERE key_hash = %s", (key,))


def _still_there(db_url: str, key: bytes) -> bool:
    with psycopg.connect(db_url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT count(*) FROM player.rate_limits WHERE key_hash = %s", (key,)
        ).fetchone()
    return row == (1,)


@pytest.mark.parametrize("tamper", TAMPERS.values(), ids=TAMPERS.keys())
def test_a_refused_report_rolls_the_purge_back(
    owner_db: Handle, db_url: str, expired_row: bytes, tamper: Tamper
) -> None:
    # The real function runs as player_owner and deletes the row; the refusal undoes that.
    with pytest.raises(UnexpectedPurgeReport):
        purge_expired(cast(Handle, _Tampered(owner_db, tamper)))
    assert _still_there(db_url, expired_row)


def test_an_untampered_report_commits_the_purge(
    owner_db: Handle, db_url: str, expired_row: bytes
) -> None:
    # The control: the same row goes when the report is the function's own.
    counts = purge_expired(cast(Handle, _Tampered(owner_db, lambda rows: rows)))
    assert tuple(kind for kind, _ in counts) == PURGE_KINDS
    assert dict(counts)["rate_limits"] >= 1
    assert not _still_there(db_url, expired_row)
