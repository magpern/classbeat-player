"""The fixed list every `Query` comes from: the query modules and the committed `.sql` files.

A new query module or migration file is added here, or it cannot be loaded (a test compares
both lists with the files in the repository).
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

QUERY_MODULES: Final = (
    "player_backend.db.queries.migrations",
    "player_backend.db.queries.login",
    "player_backend.db.queries.site_sessions",
)

SQL_DIR: Final = Path(__file__).resolve().parent.parent / "migrations"
SQL_FILES: Final = (
    "0001_tables.sql",
    "0002_policies_and_grants.sql",
    "0003_auth_functions.sql",
    "0004_login_and_sessions.sql",
)
