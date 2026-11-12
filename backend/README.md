# Backend

Python 3.12, FastAPI, PostgreSQL 17. The design is [ADR 0002](../docs/adr/0002-accounts-sign-in-pairing-and-tokens.md);
section 9 (tenant isolation) is what `db/` and `src/player_backend/db/` implement.

| Path | What |
|---|---|
| `src/player_backend/app.py` | App factory (`create_app(settings)`); `app_from_env` for the server |
| `src/player_backend/settings.py` | Settings from the environment; no secret has a default |
| `src/player_backend/log_redaction.py`, `logging_setup.py` | JSON logs; tokens, hashes, codes and credential headers never reach a line |
| `src/player_backend/db/` | Data access: the data-access modules, the migration runner and the operator's commands. The only place that may call a handle |
| `src/player_backend/db/executor/` | The executor: the only holder of the database driver. Makes every connection, hands out handles, owns `Query` and its registry |
| `src/player_backend/db/queries/` | Query modules: every SQL statement, as `Final[Query]` constants (one string literal, or a committed `.sql` file of the fixed list) |
| `src/player_backend/db/migrations/` | Ordered plain-SQL migrations, run as `player_owner` |
| `db/init/10-roles.sql` | Database init, run once as the bootstrap superuser: the three roles, database rights, log settings |
| `tests/guards/` | ADR 0002 guard tests: catalogue and source checks. Never weakened |

## Roles and setup order

1. As the bootstrap superuser, inside the backend's database:
   `psql -v ON_ERROR_STOP=1 -f db/init/10-roles.sql`. It creates `player_owner`, `player_app`
   and `player_auth`, makes `player_owner` the database owner and sets `player_app`'s log settings.
2. Set the login passwords from secret files (never in the repository), for example
   `psql -c "\password player_app"`, or `ALTER ROLE ... PASSWORD` from the deploy's secret mount.
   `player_auth` never logs in.
3. Migrations as `player_owner`: `PLAYER_DATABASE_OWNER_URL=... uv run python -m player_backend.db.migrate`.
4. The server as `player_app`:
   `PLAYER_DATABASE_URL=... uv run uvicorn --factory player_backend.app:app_from_env --no-access-log`.

Migrations are plain ordered SQL (`NNNN_name.sql`), not Alembic: the security-relevant part is
SQL that reviewers read as it runs, and the runner is small. Each file runs once, in its own
transaction, recorded with its SHA-256 in `player_meta.schema_migrations`; a changed applied file
is refused. Never edit an applied migration; add the next number, its name in the executor's
fixed list (`executor/_sources.py`), its constant in `queries/migrations.py` and its step in
`db/migrate.py` (tests fail until all three exist).

## No SQL built from strings (ADR 0002, section 9, item 1)

Two layers.

**At run time: the executor and `Query`.**

- `player_backend.db.executor` is the only code that imports `psycopg`. It makes every
  connection. No connection, cursor, transaction object or driver exception leaves it: a driver
  error becomes a `DatabaseError` (SQLSTATE and the server's primary message), raised with no
  chain to the driver's exception.
- A `Handle` has two methods: `rows(query, params)` runs a registered `Query` with bound
  parameters and returns a list of tuples; `transaction()` is a context manager. Neither takes
  text. `connect(url)` gives a handle on a connection of its own.
- A `Query` holds nothing. Its text is in the executor's registry under the object's identity.
  The registry opens when the executor is imported, loads the fixed list (`QUERY_MODULES`, and
  through them the `.sql` files in `SQL_FILES`) and freezes. Making a `Query` after that raises
  `RegistryFrozen`; running anything that is not a registered `Query` raises `NotAQuery`.
- `tests/test_query_registry.py` and `tests/test_executor_refusals.py` drive each refused input
  through the public interface.

**In the source** (`tests/guards/sql_source_check.py`, the six rules of the ADR's list): a
driver import outside the executor; a use of a driver object or of a handle's private
attributes outside it; a handle call outside `player_backend/db/`; a query constant used other
than as the first argument of `rows`; a `Query` made outside a query module; SQL text built
with an f-string, `format`, `%` or `+`. The guard is for mistakes. What it cannot see, the
run-time layer refuses.

A new statement is a new `Final[Query]` constant in a query module. A new query module is also
added to `QUERY_MODULES`. A new dependency is sorted into drivers or not in
`tests/guards/test_guard_sql_source.py`.

## Checks

`./ci.sh` runs install from the lockfile, `ruff check`, `ruff format --check`, `pyright` (strict)
and `pytest`. It needs `PLAYER_TEST_DATABASE_URL`, a superuser URL of a **throwaway**
PostgreSQL 17: the tests drop and create the three roles and a database `player_test` there, and
fail (not skip) when it is missing.

- CI (infra lane): a `postgres:17` service container with `POSTGRES_PASSWORD` set from a
  throwaway value, port 5432, and
  `PLAYER_TEST_DATABASE_URL=postgresql://postgres:<that value>@127.0.0.1:5432/postgres`.
- Locally with Docker: `docker run -d --rm --name player-pg -e POSTGRES_PASSWORD=<pw> -p 127.0.0.1:55432:5432 postgres:17`.
- Locally without Docker (PostgreSQL 17 binaries, as a non-root user):
  `initdb -D <dir> -U postgres -E UTF8 --auth=trust` and
  `pg_ctl -D <dir> -o "-p 55432 -c listen_addresses=127.0.0.1" start`, then
  `PLAYER_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres`.

Without the variable, `uv run pytest` skips the database tests and runs the rest.
