"""Loads a committed `.sql` file shipped in this package, for a query module's constant.

The only way a query module gets SQL that is not a string literal in its own source
(tests/guards/sql_source_check.py). The name must be a plain file in `migrations/`.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import LiteralString, cast

SQL_DIR = Path(__file__).with_name("migrations")
_NAME = re.compile(r"^\d{4}_[a-z0-9_]+\.sql$")


def sql_file(name: str) -> LiteralString:
    if not _NAME.match(name):
        raise ValueError(f"not a migration file name: {name}")
    # A file committed in the repository, read once at import: as fixed as a literal.
    return cast(LiteralString, (SQL_DIR / name).read_text(encoding="utf-8"))
