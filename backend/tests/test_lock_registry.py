"""The one list of advisory locks (`player_backend.lock_registry`), without a database.

No number or prefix is used twice, and the SQL (migrations and every string literal of the
source tree) takes no advisory lock but those of the list, each at exactly the places the list
names and in the form the list says: a number, a prefix hashed with the account, or a bigint
parameter. Function names are matched in any letter case, as SQL reads them. That the callers
pass the keys the database sees is checked against `pg_locks` in tests/test_passkey_races.py
and tests/test_sign_in_races.py.
"""

from __future__ import annotations

import ast
import re
from collections import Counter
from pathlib import Path

import pytest

from player_backend import lock_registry as locks

SRC = Path(__file__).resolve().parents[1] / "src" / "player_backend"
_I = re.IGNORECASE
# Every call of an advisory lock function, whatever its kind: session or transaction, shared or
# not, waiting or `try`, lock or unlock.
_CALL = re.compile(r"pg_(?:try_)?advisory_(?:xact_)?(?:un)?lock(?:_shared)?(?:_all)?\s*\(", _I)
_TRANSACTION = re.compile(r"pg_(?:try_)?advisory_xact_lock\s*\(", _I)
_NUMBER = re.compile(r"\s*(\d+)\s*[,)]")
_HASHED = re.compile(r"\s*hashtextextended\s*\(\s*'([^']*)'\s*\|\|", _I)
_PARAMETER = re.compile(r"\s*%s::bigint\s*\)", _I)

type Site = tuple[int | str, str]


def _texts() -> list[tuple[str, str]]:
    """(where, text): every migration, and every string literal of the source tree."""
    found = [
        (str(p.relative_to(SRC)), p.read_text())
        for p in sorted((SRC / "db" / "migrations").glob("*.sql"))
    ]
    for path in sorted(SRC.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                found.append((str(path.relative_to(SRC)), node.value))
    return found


def _key_of(where: str, call: str, rest: str) -> int | str:
    """The registry key a call takes, from the text after its parenthesis; fails otherwise."""
    assert _TRANSACTION.match(call), f"{where}: not a transaction lock: {call[:60]}"
    if number := _NUMBER.match(rest):
        return int(number.group(1))
    if hashed := _HASHED.match(rest):
        return hashed.group(1)
    if _PARAMETER.match(rest):
        (key,) = [k for k in locks.PARAMETER_KEYS if where in locks.SITES[k]] or ["?"]
        return key
    raise AssertionError(f"{where}: a lock key the list does not describe: {call[:80]}")


def _sites(texts: list[tuple[str, str]]) -> Counter[Site]:
    """(key, where) of every advisory lock call, counted."""
    found: Counter[Site] = Counter()
    for where, text in texts:
        for match in _CALL.finditer(text):
            call = text[match.start() : match.end() + 120]
            found[(_key_of(where, call, text[match.end() : match.end() + 120]), where)] += 1
    return found


def _listed() -> Counter[Site]:
    return Counter((key, where) for key, places in locks.SITES.items() for where in places)


def test_no_number_or_prefix_is_used_twice() -> None:
    numbers = list(locks.NUMBERS.values())
    assert len(set(numbers)) == len(numbers)
    assert not set(numbers) & locks.RETIRED
    assert len(set(locks.HASHED_PREFIXES)) == len(locks.HASHED_PREFIXES)
    # No prefix is the start of another, so two of them never hash the same text.
    for one in locks.HASHED_PREFIXES:
        assert not any(o != one and o.startswith(one) for o in locks.HASHED_PREFIXES)
    # Every lock has its places, and only listed locks have places.
    keys = [*numbers, *locks.HASHED_PREFIXES, *locks.PARAMETER_KEYS]
    assert len(set(keys)) == len(keys)
    assert set(locks.SITES) == set(keys)
    assert all(locks.SITES.values())
    # The module's numbers are the list's: no number of its own outside it.
    constants = {
        name: value for name, value in vars(locks).items() if name.isupper() and type(value) is int
    }
    assert constants == locks.NUMBERS


def test_the_sql_takes_the_listed_locks_at_the_listed_places_only() -> None:
    found = _sites(_texts())
    assert found, "no advisory lock found: the search is broken"
    assert found == _listed()


@pytest.mark.parametrize(
    "extra",
    [
        "SELECT PG_ADVISORY_XACT_LOCK(7270099)",  # an unlisted number, in capitals
        "SELECT pg_advisory_xact_lock(7270003, 5)",  # a listed number at a new place
        "SELECT pg_advisory_xact_lock(7270012, 5)",  # a retired number
        "SELECT Pg_Advisory_Lock(7270001)",  # a session lock
        "SELECT pg_advisory_xact_lock(hashtextextended('source.links:' || x, 0))",  # reused
        "SELECT pg_try_advisory_xact_lock(%s::bigint)",  # a parameter lock at a new place
        "SELECT pg_advisory_xact_lock(%s, %s)",  # a key form the list does not describe
        "SELECT pg_advisory_unlock_all()",
    ],
)
def test_a_lock_outside_the_list_is_caught(extra: str) -> None:
    """Each of these, added to a query module, makes the SQL differ from the list."""
    texts = [*_texts(), ("db/queries/other.py", extra)]
    with pytest.raises(AssertionError):
        assert _sites(texts) == _listed()
