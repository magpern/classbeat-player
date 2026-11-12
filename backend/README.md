# Backend

Python 3.12, FastAPI, PostgreSQL 17. The design is [ADR 0002](../docs/adr/0002-accounts-sign-in-pairing-and-tokens.md);
section 9 (tenant isolation) is what `db/` and `src/player_backend/db/` implement.

| Path | What |
|---|---|
| `src/player_backend/app.py` | App factory (`create_app(settings)`); `app_from_env` for the server |
| `src/player_backend/settings.py` | Settings from the environment; no secret has a default |
| `src/player_backend/log_redaction.py`, `logging_setup.py` | JSON logs; tokens, hashes, codes and credential headers never reach a line |
| `src/player_backend/db/` | Data access: the only package that may import a database driver |
| `src/player_backend/db/queries/` | Query modules: every SQL statement, as `Final` constants (string literals or committed `.sql` files) |
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
is refused. Never edit an applied migration; add the next number, its constant in
`queries/migrations.py` and its step in `db/migrate.py` (a test fails until both exist).

**SQL in the source is an allowlist** (`tests/guards/sql_source_check.py`): every statement is a
constant of a query module, and every call that executes SQL takes a direct reference to one
(`queries_module.NAME`, or a `NAME` imported from it). Anything else fails the guard.

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
