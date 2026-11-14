"""The text rules of the private-import guard (private_import_check.py; #339): a private
Starlette name spelled in a string or in the code itself, wherever it is.

- A string or bytes constant, or a constant part of an f-string, with no space in it but at
  its ends, that holds `starlette.` must be a public dotted name (`"starlette.routing"`).
  Anything else is refused: `"starlette._utils"`, `"pkg.starlette._x"`, the start of a name
  such as `"starlette._"` or `"starlette."`, and a template such as `"starlette.%s"` or
  `"starlette.{}"`. A message, which has spaces (`"see starlette._utils"`), passes.
- A constant `"starlette"` joined to more text by `+` or in an f-string: a name being built.
- The old whole-text backstop, `starlette . _x`, kept over the code's own tokens: comments and
  strings are left out (the rules above cover strings), and so are dunders.
"""

from __future__ import annotations

import ast
import io
import re
import tokenize
from typing import Final

_DOTTED: Final = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*")
_STARLETTE_DOT: Final = re.compile(r"(?<![A-Za-z0-9_])starlette\.")
_BACKSTOP: Final = re.compile(r"\bstarlette\s*\.\s*(_\w*)")
_SKIPPED: Final = frozenset(
    {tokenize.COMMENT, tokenize.STRING, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT}
    | {tokenize.DEDENT, tokenize.FSTRING_START, tokenize.FSTRING_MIDDLE, tokenize.FSTRING_END}
)


def is_private(name: str) -> bool:
    """`_x`, `__x` and `_` are private; a dunder such as `__init__` is not."""
    dunder = len(name) > 4 and name.startswith("__") and name.endswith("__")
    return name.startswith("_") and not dunder


def refused_starlette_text(text: str) -> bool:
    """A string with no space but at its ends, with `starlette.` in it, that is not a public
    dotted name: `"starlette._utils"`, `"starlette._"`, `"pkg.starlette._x"`, `"starlette.%s"`."""
    text = text.strip()
    if any(c.isspace() for c in text) or not _STARLETTE_DOT.search(text):
        return False
    return not _DOTTED.fullmatch(text) or any(is_private(p) for p in text.split("."))


def _builds_a_name(text: str) -> bool:
    return text == "starlette"


def string_violations(tree: ast.Module) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str | bytes):
            text = node.value if isinstance(node.value, str) else node.value.decode("latin-1")
            if refused_starlette_text(text):
                found.append((node.lineno, f"private module named: {node.value!r}"))
        elif isinstance(node, ast.JoinedStr | ast.BinOp):
            parts = node.values if isinstance(node, ast.JoinedStr) else [node.left, node.right]
            if any(
                isinstance(p, ast.Constant) and isinstance(p.value, str) and _builds_a_name(p.value)
                for p in parts
            ):
                found.append((node.lineno, "a Starlette module name is built"))
    return found


def backstop_violations(source: str) -> list[tuple[int, str]]:
    """`starlette . _x` in the code's tokens, comments and strings left out."""
    lines: dict[int, list[str]] = {}
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type not in _SKIPPED:
            lines.setdefault(token.start[0], []).append(token.string)
    # Joined across lines too, so a chain split over a line break is still seen.
    rows = sorted(lines)
    text = " ".join(" ".join(lines[r]) for r in rows)
    return [
        (rows[0] if rows else 0, f"private name in code: starlette.{m.group(1)}")
        for m in _BACKSTOP.finditer(text)
        if is_private(m.group(1))
    ]
