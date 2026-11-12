"""Guard: `deliver` (mail_delivery.py) is the one caller of `Mailer.send`.

`deliver` gives `send` its time limit and keeps a failed `send` out of the logs but for the
error's type: a sign-in mail holds a token and an address. A `send` called anywhere else would
have neither. So, in the backend's source, a `.send` attribute (called or handed on), and the
name as a string (for `getattr`), is allowed in that one module only, and there exactly once.
Defining `send` on a mailer is not a use of it.

An allowlist: something else named `send` fails here until someone has said how the guard is
to tell it from a mailer's. Like the other source guards, it is for mistakes, not for code
written to get round it.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[2] / "src"
DELIVERY_MODULE = "player_backend/mail_delivery.py"


def uses_of_send(source: str) -> list[int]:
    """The lines of `source` that reach for a `send`."""
    found: list[int] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Attribute) and node.attr == "send":
            found.append(node.lineno)
        elif isinstance(node, ast.Constant) and node.value == "send":
            found.append(node.lineno)
    return sorted(found)


def test_send_is_used_in_the_delivery_module_alone_and_once() -> None:
    found = {
        path.relative_to(SRC).as_posix(): uses
        for path in sorted(SRC.rglob("*.py"))
        if (uses := uses_of_send(path.read_text(encoding="utf-8")))
    }
    assert list(found) == [DELIVERY_MODULE]
    assert len(found[DELIVERY_MODULE]) == 1


def test_the_one_use_is_the_call_inside_deliver() -> None:
    tree = ast.parse((SRC / DELIVERY_MODULE).read_text(encoding="utf-8"))
    calls = [
        (function.name, ast.unparse(node))
        for function in ast.walk(tree)
        if isinstance(function, ast.FunctionDef)
        for node in ast.walk(function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "send"
    ]
    assert calls == [("deliver", "mailer.send(mail, timeout=SEND_TIMEOUT_SECONDS)")]


@pytest.mark.parametrize(
    "snippet",
    [
        "state.mailer.send(mail, timeout=1.0)",
        "BackgroundTask(state.mailer.send, mail)",
        "hand_over = mailer.send",
        'getattr(mailer, "send")(mail, timeout=1.0)',
        "NoMailer().send(mail, timeout=1.0)",
    ],
)
def test_reaching_for_send_is_found(snippet: str) -> None:
    assert uses_of_send(snippet) == [1]


@pytest.mark.parametrize(
    "snippet",
    [
        "class M:\n    def send(self, mail, *, timeout): ...",
        "BackgroundTask(deliver, state.mailer, mail)",
        '_log.warning("mail dropped: nothing was sent")',
    ],
)
def test_defining_send_and_calling_deliver_pass(snippet: str) -> None:
    assert uses_of_send(snippet) == []
