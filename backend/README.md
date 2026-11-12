# Backend

Python 3.12, FastAPI, PostgreSQL 17. The design is [ADR 0002](../docs/adr/0002-accounts-sign-in-pairing-and-tokens.md);
section 9 (tenant isolation) is what `db/` and `src/player_backend/db/` implement.

| Path | What |
|---|---|
| `src/player_backend/app.py` | App factory (`create_app(settings)`); `app_from_env` for the server |
| `src/player_backend/settings.py` | Settings from the environment; no secret has a default |
| `src/player_backend/site/` | The site's API, `/api/site/`: email link sign-in, site sessions, the user's side of pairing and the account's devices (ADR 0002, sections 4, 5 and 6). `cookies.py` is the only module that reads a cookie; `deps.py` has the one dependency of the session credential, the origin check and the recent sign-in check |
| `src/player_backend/player_api/` | The app's side: pairing (`/api/pairing/`) and the player API (`/api/player/`). No cookie is read here. `deps.py` has the one dependency of the device token |
| `src/player_backend/source_api/` | The source API, `/api/source/`: the code exchange, publications, a source's own numbers and its own link (ADR 0002, section 7). No cookie is read here. `deps.py` has the one dependency of the source token |
| `src/player_backend/class_schemas.py` | Reads the class format's schemas from `schema/class-format/v1/` (ADR 0003); the validators are the contract lane's `classformat` package |
| `src/player_backend/*_policy.py` | Pure rules, no I/O: token shape and hash, short codes, the client address and what is kept of it, the request checks and response headers, sign-in, pairing, the bearer header and its limits, linking a source, a publication's checks, class sync's cursor and pages |
| `src/player_backend/bearer_blocks.py` | What one process remembers about bearer tokens it refuses without a lookup (section 10). In memory only |
| `src/player_backend/mail.py`, `mail_delivery.py`, `no_mailer.py` | The mail interface. `send` takes a time limit; `deliver` is its one caller and logs a failed `send` by the error's type alone. Without an SMTP host every mail is dropped (`NoMailer`); tests use fakes |
| `src/player_backend/smtp_mailer.py`, `smtp_deadline.py`, `smtp_settings.py` | The SMTP mailer (see "Mail"): TLS always and verified, one time limit for the whole conversation, the password from a file |
| `src/player_backend/admin.py`, `db/operator.py` | The operator's commands, as `player_owner` (see "Operator commands") |
| `src/player_backend/log_redaction.py`, `logging_setup.py` | JSON logs; tokens, hashes, codes and credential headers never reach a line |
| `src/player_backend/db/` | Data access: the data-access modules, the migration runner and the operator's commands. The only place that may call a handle |
| `src/player_backend/db/executor/` | The executor: the only holder of the database driver. Makes every connection and the pool, hands out handles, owns `Query` and its registry |
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
   `PLAYER_DATABASE_URL=... PLAYER_SITE_ORIGIN=https://<site host> uv run uvicorn --factory
   player_backend.app:app_from_env --no-access-log --no-proxy-headers`. The client address
   comes from `X-Forwarded-For` only for peers in `PLAYER_TRUSTED_PROXIES`, so uvicorn's own
   proxy handling stays off.

Migrations are plain ordered SQL (`NNNN_name.sql`), not Alembic: the security-relevant part is
SQL that reviewers read as it runs, and the runner is small. Each file runs once, in its own
transaction, recorded with its SHA-256 in `player_meta.schema_migrations`; a changed applied file
is refused. Never edit an applied migration; add the next number, its name in the executor's
fixed list (`executor/_sources.py`), its constant in `queries/migrations.py` and its step in
`db/migrate.py` (tests fail until all three exist).

## Mail

`app_from_env` uses the SMTP mailer when `PLAYER_SMTP_HOST` is set, and `NoMailer` (every
mail dropped, logged as `mail.not_configured`) when it is not. Which mail service is used is
the owner's choice (`docs/owner.md`).

| Setting | |
|---|---|
| `PLAYER_SMTP_HOST` | The server's host name. Without it no other `PLAYER_SMTP_` setting may be set |
| `PLAYER_SMTP_TLS` | `implicit` (default; TLS from the first byte) or `starttls`. There is no plain mode |
| `PLAYER_SMTP_PORT` | Default 465 for `implicit`, 587 for `starttls` |
| `PLAYER_SMTP_FROM` | The sender, a plain `name@host` address |
| `PLAYER_SMTP_USER`, `PLAYER_SMTP_PASSWORD_FILE` | Both or neither. The password is read once at start-up from that file (one line; a final line break is dropped). `PLAYER_SMTP_PASSWORD` is refused |
| `PLAYER_SMTP_HELO_NAME` | The name given in `EHLO`, default `localhost`, so that no lookup of the local host is made |

- The certificate and the host name are verified against the system's trust store, TLS 1.2 at
  least. With `starttls`, a server that offers no STARTTLS gets no login and no mail. After
  STARTTLS nothing read before it is kept.
- `send` keeps to the limit `deliver` gives it (10 seconds) for the whole conversation: each step
  gets the time that is left, and a watchdog shuts the connection when it runs out. Only the
  name lookup of the host is the system's.
- Nothing of a mail is logged or printed; a failure reaches the log as its type alone
  (`mail not sent: SMTPAuthenticationError`).
- Tests: a fake server on loopback with certificates made for the run (`tests/smtphelp.py`).
  Every test runs under the network guard (`tests/netguard.py`): no lookup of a name but
  `localhost` and no connect past loopback.

## Operator commands

Run on the server as `player_owner`, with `PLAYER_DATABASE_OWNER_URL` as for migrations. The
commands check the role they connect as and refuse anything but `player_owner`; they never read
`PLAYER_DATABASE_URL`.

```bash
python -m player_backend.admin allowlist add <email>     # trimmed and lower-cased first
python -m player_backend.admin allowlist remove <email>
python -m player_backend.admin allowlist list            # email, tab, when it was added
python -m player_backend.admin purge                     # auth_purge_expired(), once
```

The allowlist is changed through its one policy (ADR 0002, section 9) and nothing else.
`purge` calls `auth_purge_expired()` once, in its own transaction; the function returns
nothing, so the command prints only that it ran. A database error is printed as its type and
SQLSTATE, never its message. Exit status: 0 done, 1 refused or failed, 2 bad input or no URL.

**The purge schedule.** `purge` runs every hour on the server, outside the web process. The
deploy files are the infra lane's; until they exist, the schedule is this cron line, with the
URL in an environment file that only the deploy user can read:

```cron
17 * * * *  set -a; . /etc/classbeat-player/owner.env; set +a; python -m player_backend.admin purge
```

## Sign-in and site sessions (ADR 0002, sections 4, 5, 10 and 11)

| Route (all under `/api/site/`) | Does |
|---|---|
| `POST sign-in/link` `{email}` | Always `200 {"status":"accepted"}`, whether or not the address can sign in. Sets `__Host-cbp_login` when the browser has none. `429` only for the requester's own limit (10 an hour per address) |
| `POST sign-in/complete` `{token}` | Uses a link: once, within 15 minutes, in the browser that asked. Sets `__Host-cbp_session`. Every refusal is `401 sign_in_refused` |
| `GET sessions` | The account's live sessions |
| `DELETE sessions/{id}`, `POST sign-out` | End one session, or this one. Signing out with no live session is `204` too, and clears the cookie |
| `POST sessions/end-all` | Sign out everywhere. Needs a sign-in within the last 10 minutes (`403 recent_sign_in_required`) |

- Migration `0004` gives `rate_limit_hit`, `auth_enter_session`, `auth_request_login` and
  `auth_complete_login` their bodies, with ADR 0002's defaults written in the SQL, as in
  `auth_purge_expired`. The other functions still fail closed. Migration `0005` replaces the
  bodies of the last two. A link request does the same lookups and writes whether or not the
  address can sign in, with the two differences ADR 0002 names: the "link requested" event of
  an address that has an account, and no count toward the total per email for a request over
  its per-pair limits. A newer link cancels the browser's older ones only when the request is
  within its limits. An advisory lock each makes two link requests from one browser leave one
  usable link and two sign-ins at once leave at most 20 sessions.
- A signed-in request is one transaction: `site_session` (`site/deps.py`) calls
  `auth_enter_session` as its first statement and yields an `AccountContext` with the handle.
  It is committed after the route's function returns and before the response is sent. When
  the route refuses (403, 404), what the route wrote is rolled back and the session's "last
  used" is kept; any other error rolls back everything.
- Every state change needs `Origin` equal to `PLAYER_SITE_ORIGIN` and, when present,
  `Sec-Fetch-Site: same-origin`. Every response has the page headers of section 5, and the
  site's API is `Cache-Control: no-store`.
- Guards: `tests/guards/test_guard_cookie_routes.py` (the routes that read a cookie equal the
  written list, every route is on one of the credential lists; cookies are read in
  `site/cookies.py` only) and `tests/guards/test_guard_endpoint_isolation.py` (two accounts,
  every endpoint that enters an account, by a session or by a device token).

## Pairing a device and the device token (ADR 0002, sections 2, 3, 6, 10 and 11)

| Route | Credential | Does |
|---|---|---|
| `POST /api/pairing/start` `{platform, version}` | None | Returns `device_code`, `user_code` (`XXXX-XXXX`), `verification_uri` (`<site>/pair`, without the code), `expires_in: 600`, `interval: 5`. `429` over 10 starts an hour per address |
| `POST /api/pairing/token` `{device_code}` | The device code, in the body | `200 {device_token, email}` once, on the first poll after approval. Otherwise `400` with `authorization_pending`, `slow_down`, `access_denied` or `expired_token` (also for a used or unknown code, and for anything that is not a `cbp_dc_` token, which is refused before any lookup) |
| `POST /api/site/pairing/find` `{code}` | Session cookie | `200 {platform, version}` of the pending pairing; changes nothing. `404 pairing_not_found` for a wrong code, an ended or decided pairing and a closed form alike |
| `POST /api/site/pairing/decide` `{code, approve, name}` | Session cookie | `200 {"status": "approved" or "denied"}`. `404 pairing_not_found` as above; `409 too_many_devices` for an approval at 10 active devices, pairings that are approved and not collected yet included; `422 invalid_name` |
| `GET /api/site/devices`, `DELETE /api/site/devices/{id}` | Session cookie | List the devices that are not revoked (`last_used_at: null` is "never used"); revoke one |
| `GET /api/player/device`, `DELETE /api/player/device` | `Authorization: Bearer cbp_dev_…` | The device's own name, platform, version and paired date; the app revokes its own token |

- Migration `0006` gives `auth_start_pairing`, `auth_find_pairing`, `auth_decide_pairing`,
  `auth_collect_pairing` and `auth_enter_device` their bodies, with ADR 0002's numbers as
  constants in the SQL (principle 7). No grant, table or function is added.
  `auth_device_active` still fails closed (PL8). Migration `0007` replaces the body of
  `auth_decide_pairing`: an approval refused at the cap returns `NULL` (not `false`, which is a
  wrong code or a closed form), so the site can answer `409` whatever fills the cap. The cap
  is checked by the function alone.
- `/api/pairing/start` and `/api/pairing/token` take no credential and are for the desktop
  app alone (`app_only`, `player_api/deps.py`): a request with a `Sec-Fetch-Site` header that
  is not `none` (a page in a browser) is `403 cross_site_request`, and a body that is not sent
  as `application/json` is `415 unsupported_media_type`, both before anything is counted.
- Wrong codes are counted inside the database, at the look-up and the decision together: the
  fifth in 15 minutes closes the account's form for 15 minutes. The two site routes *return*
  their `404` instead of raising it, so the request's transaction commits and the count stays.
  The `409` is returned the same way, so its `pairing.refused` event stays.
- A device-token request is one transaction: `device_token` (`player_api/deps.py`) calls
  `auth_enter_device` as its first statement and yields an `AccountContext`. A token that does
  not work is answered `401` with `token_revoked`, `token_unknown` or `token_expired` and
  `WWW-Authenticate: Bearer`, after its transaction (and so its counters) has been committed.
  Anything that is not a `cbp_dev_` bearer token is `401 invalid_token`, with nothing looked up.
  When a player route refuses the request (an `ApiError`), what the route wrote is rolled back
  and the token's request count and the device's "last used" are kept, as for a site session.
- Limits (section 10): 60 requests a minute per device token; the same unknown or revoked token
  from one address 20 times in 5 minutes is then refused (`429`) for 5 minutes without a
  lookup, from this process's memory; over 200 unknown tokens in 5 minutes from one address,
  further unknown ones get `429` until the window ends, and valid tokens keep working. The
  address's counter is counted first: over it, no per-token counter row is written.
- A paired device sends the account a mail, after the response. Events: `pairing.approved`,
  `pairing.denied`, `pairing.refused` (the cap) and `device.created` inside the functions;
  `device.revoked` by the backend.
- Responses under `/api/pairing/` and `/api/player/` are `Cache-Control: no-store`.

## Class sync for the player (ADR 0002, sections 6, 7 and 9)

Read only, with a device token, for its account (`player_api/sync.py`, `db/class_sync.py`, the
pure rules in `sync_policy.py`). A cursor is the account's own `account_sync` position: 0 before
its first publication, and it only grows.

| Route | What |
|---|---|
| `GET /api/player/changes?after=<cursor>&limit=<n>` | The class rows whose place is above `after` (default 0), in sync order, at most `limit` (1 to 500, default 100): `{changes: [{class_id, source, source_class_id, publication_number, removed, content_hash, published_at, position}], cursor, more}`. No content. A removal is its class's own row, with `removed: true` and no hash. `cursor` is the place of the page's last change (`after` for an empty page). A cursor above the account's own is `409 resync_required` with the current `cursor`: it was never this account's |
| `GET /api/player/classes/{class_id}` | One class the account holds now: `{class_id, source, source_class_id, publication_number, content_hash, position, document}`. A removal's marker, an unknown id and another account's id are all `404 not_found` |
| `GET /api/player/cursor` | `{cursor}` |

Each request counts towards the device token's 60 a minute; nothing else is written.

## Linking a source, the source token and publications (ADR 0002, sections 3, 7, 10 and 11)

Known sources are the setting `PLAYER_SOURCES`: a JSON list of `{id, name, redirect_uris}`, the
exact HTTPS addresses (HTTP on loopback for development) a source may be sent back to. Empty by
default: no source can be linked.

| Route | Credential | What |
|---|---|---|
| `POST /api/site/source-links/check` `{source, redirect_uri}` | Session cookie | `200 {source, name, scope}`; `400 unknown_source` for an unknown source or address (the page then redirects nowhere) |
| `POST /api/site/source-links/approve` `{source, redirect_uri, state, code_challenge, code_challenge_method?}` | Session cookie | `200 {redirect}`: the redirect address with `code` (`cbp_lc_`, 60 seconds, single use) and `state`, for the page's script to go to. `409 too_many_links` at 5 links; `422` for a challenge that is not S256 or a bad state. The account gets a mail |
| `GET /api/site/source-links`, `DELETE /api/site/source-links/{link_id}` | Session cookie | The account's links (source, linked, last used); revoking deletes the link, the classes stay |
| `POST /api/source/token` `{source, code, redirect_uri, code_verifier}` | The link code, in the body | `200 {source_token, token_type}` once. `400 invalid_grant` for every refusal (a code that is not `cbp_lc_` is refused before any lookup); `429` over 10 exchanges a minute per address |
| `POST /api/source/publications` (ADR 0003, section 6) | `Authorization: Bearer cbp_src_…` | `200 {status: applied or repeat, highest_publication_number}`; `409 stale_publication` or `publication_conflict` with `highest_publication_number`; `409 too_many_classes` at 2,000; `422` (`invalid_publication`, `content_hash_mismatch`, `unsupported_format_version`); `413 document_too_large` over 1 MiB |
| `GET /api/source/classes/{source_class_id}` | Source token | The highest number seen and whether it was a removal. Numbers only |
| `DELETE /api/source/link` | Source token | The source ends its own link |

- Migration `0008` gives `auth_new_link_code`, `auth_exchange_link_code` and
  `auth_enter_source` their bodies, ADR 0002's numbers as constants in them. The exchange checks
  the code's account, source, redirect address and PKCE verifier, uses the code up whatever
  follows, refuses above 5 links, and writes `source.linked` or `source.link_refused`.
- A source token ends after 365 days without use; "last used" is written at most once every 5
  minutes. Every source API request counts toward 60 a minute per token; the bearer limits of
  the device token apply to unknown source tokens too.
- A publication is decided in the request's transaction under the class row's lock (a
  placeholder with number 0 first). A refusal is rolled back to a savepoint and its event
  (`publication.stale`, `publication.conflict`, `publication.refused`) is written in a second
  transaction that enters the account again with `auth_enter_source`; the request's count and
  "last used" stay. `publication.applied` and `source.revoked` are written by the backend.
- The document is checked in readers' mode (any minor of major 1) and stored in its RFC 8785
  form; the envelope takes no field beyond its five.

## No SQL built from strings (ADR 0002, section 9, item 1)

Two layers.

**At run time: the executor and `Query`.**

- `player_backend.db.executor` is the only code that imports `psycopg` and `psycopg_pool`.
  It makes every connection, and the pool of the running backend (`open_pool`), which
  lends handles and nothing else. No connection, cursor, transaction object or driver exception leaves it: a driver
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
