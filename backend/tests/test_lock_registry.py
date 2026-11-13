"""The one list of advisory locks (`player_backend.lock_registry`), without a database.

No number or prefix is used twice, and the SQL (migrations and query modules) takes no advisory
lock but one of the list, each in the form the list says: a number of the list, a prefix of the
list hashed with the account, or a parameter for the numbers the caller passes. Every entry of
the list has a user. That the callers pass the list's numbers, and the database sees them, is
checked against `pg_locks` in tests/test_passkey_races.py and tests/test_sign_in_races.py.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from player_backend import lock_registry as locks

SRC = Path(__file__).resolve().parents[1] / "src" / "player_backend"
# Every call of an advisory lock function, whatever its kind: session or transaction, shared or
# not, waiting or `try`.
_CALL = re.compile(r"pg_(?:try_)?advisory_(?:xact_)?(?:un)?lock(?:_shared)?(?:_all)?\s*\(")
_NUMBER = re.compile(r"\s*(\d+)\s*[,)]")
_HASHED = re.compile(r"\s*hashtextextended\s*\(\s*'([^']*)'\s*\|\|")
_PARAMETER = re.compile(r"\s*%s\s*,\s*%s\s*\)")
_TRANSACTION = re.compile(r"pg_(?:try_)?advisory_xact_lock\s*\(")


def _sql_texts() -> list[tuple[str, str]]:
    """(where, text): every migration, and every string literal of the source tree."""
    found = [(p.name, p.read_text()) for p in sorted((SRC / "db" / "migrations").glob("*.sql"))]
    for path in sorted(SRC.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                found.append((str(path.relative_to(SRC)), node.value))
    return found


def _calls() -> list[tuple[str, str, int]]:
    """(where, the call, the length of its name and parenthesis) of every advisory lock call."""
    return [
        (where, text[match.start() : match.end() + 120], match.end() - match.start())
        for where, text in _sql_texts()
        for match in _CALL.finditer(text)
    ]


def test_no_number_or_prefix_is_used_twice() -> None:
    numbers = list(locks.NUMBERS.values())
    assert len(set(numbers)) == len(numbers)
    assert len(set(locks.NUMBERS)) == len(locks.NUMBERS)
    assert len(set(locks.HASHED_PREFIXES)) == len(locks.HASHED_PREFIXES)
    # No prefix is the start of another, so two of them never hash the same text.
    for one in locks.HASHED_PREFIXES:
        assert not any(o != one and o.startswith(one) for o in locks.HASHED_PREFIXES)
    assert locks.PASSED_AS_PARAMETER <= set(numbers)
    # The module's constants are the list's: no number of its own outside it.
    constants = {
        name: value
        for name, value in vars(locks).items()
        if name.isupper() and isinstance(value, int)
    }
    assert constants == locks.NUMBERS


def test_the_sql_takes_only_the_listed_locks() -> None:
    calls = _calls()
    assert calls, "no advisory lock found: the search is broken"
    numbers: set[int] = set()
    prefixes: set[str] = set()
    parameters = 0
    for where, call, opened in calls:
        assert _TRANSACTION.match(call), f"{where}: not a transaction lock: {call[:60]}"
        rest = call[opened:]
        if number := _NUMBER.match(rest):
            numbers.add(int(number.group(1)))
        elif hashed := _HASHED.match(rest):
            prefixes.add(hashed.group(1))
        elif _PARAMETER.match(rest):
            parameters += 1
        else:
            raise AssertionError(f"{where}: a lock key the list does not describe: {call[:80]}")
    listed = set(locks.NUMBERS.values())
    assert numbers == listed - locks.PASSED_AS_PARAMETER
    assert prefixes == set(locks.HASHED_PREFIXES)
    assert parameters == len(locks.PASSED_AS_PARAMETER)


def test_the_search_sees_each_kind_of_call() -> None:
    """The patterns recognise every form, so a lock outside the list cannot slip past them."""
    for text in (
        "pg_advisory_lock(1)",
        "pg_advisory_xact_lock_shared(1, 2)",
        "pg_try_advisory_lock(1)",
        "pg_advisory_unlock_all()",
        "PERFORM pg_advisory_xact_lock (7270002, x)",
    ):
        assert _CALL.search(text), text
    assert not _TRANSACTION.match("pg_advisory_lock(1)")
    assert _NUMBER.match(" 7270001)") and _NUMBER.match("7270003, ('x'")
    assert _HASHED.match("hashtextextended('pairing.codes:' || v_account::text, 0))")
