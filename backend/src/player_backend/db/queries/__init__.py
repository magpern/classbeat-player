"""Query modules: every SQL statement of the backend, as `Query` constants (ADR 0002, section 9).

The executor loads them, in its fixed list, while its registry is open. Importing it here first
makes that hold whichever module is imported first.
"""

import player_backend.db.executor  # noqa: F401  # pyright: ignore[reportUnusedImport]
