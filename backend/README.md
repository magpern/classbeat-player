# Backend

Python 3.12, FastAPI, PostgreSQL 17. The design is [ADR 0002](../docs/adr/0002-accounts-sign-in-pairing-and-tokens.md);
section 9 (tenant isolation) is what `db/` and `src/player_backend/db/` implement.

| Path | What |
|---|---|
| `src/player_backend/app.py` | App factory (`create_app(settings)`); `app_from_env` for the server |
| `src/player_backend/settings.py` | Settings from the environment; no secret has a default |
| `src/player_backend/site/` | The site's API, `/api/site/`: email link sign-in, site sessions, the user's side of pairing, the account's devices and its class library: list, read, delete (ADR 0002, sections 4, 5, 6, 7 and 12). `cookies.py` is the only module that reads a cookie; `deps.py` has the one dependency of the session credential, the origin check and the recent sign-in check |
| `src/player_backend/live/` | The live process: sessions in memory, `POST /api/live/sessions`, the re-check and its listener (ADR 0002, section 8; ADR 0005) |
| `src/player_backend/player_api/` | The app's side: pairing (`/api/pairing/`) and the player API (`/api/player/`). No cookie is read here. `deps.py` has the one dependency of the device token |
| `src/player_backend/source_api/` | The source API, `/api/source/`: the code exchange, publications, a source's own numbers and its own link (ADR 0002, section 7). No cookie is read here. `deps.py` has the one dependency of the source token |
| `src/player_backend/class_schemas.py` | Reads the class format's schemas from `schema/class-format/v1/` (ADR 0003); the validators are the contract lane's `classformat` package |
| `src/player_backend/*_policy.py` | Pure rules, no I/O: token shape and hash, short codes, the client address and what is kept of it, the request checks and response headers, sign-in, pairing, the bearer header and its limits, linking a source, a publication's checks, class sync's cursor and pages, the class library's pages |
| `src/player_backend/lock_registry.py` | Every advisory lock (numbers, hashed prefixes, parameter keys) and the places it is taken, in one list; `tests/test_lock_registry.py` checks the SQL against it |
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
  gets the time that is left, and a watchdog shuts the connection when it runs out. The name
  lookup of the host runs on a thread of its own and is waited for no longer than the time left.
- Nothing of a mail is logged or printed; a failure reaches the log as its type alone
  (`mail not sent: SMTPAuthenticationError`).
- Tests: a fake server on loopback with certificates made for the run (`tests/smtphelp.py`).
  Every test runs under the network guard (`tests/netguard.py`): no lookup of a name but
  `localhost` and no connect past loopback.

## Operator commands

Run on the server as `player_owner`, with `PLAYER_DATABASE_OWNER_URL` as for migrations. The
commands check the role they connect as and refuse anything but `player_owner`; they never read
`PLAYER_DATABASE_URL`. The check reads `current_user`, so a superuser's URL that sets the role
(`options=-c role=player_owner`) passes it too. The commands then still act as `player_owner`
and do nothing more, but give them `player_owner`'s own login, never a superuser's.

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
deploy files run it as the `purge` service of `docker/compose.backend.yml`; see
`docs/runbooks/backend-deploy.md`.

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
  usable link and two sign-ins at once leave at most 20 sessions. Migration `0012` bounds the
  wait for the sign-in lock (in `auth_complete_login` and `auth_complete_passkey`) to 2 seconds,
  as `passkey_policy.ADDITIONS_LOCK_WAIT` bounds the passkey-additions lock (#158): a wait that
  runs out rolls the call back and is answered 429 with `Retry-After: 1`, the link, challenge
  or registration not used up (`tests/test_lock_waits.py`).
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
  `auth_device_active` has its body from migration `0013` (below). Migration `0007` replaces the body of
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
  `auth_enter_device` (after naming the budget, below) and yields an `AccountContext`. A token that does
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

Each request counts towards one of the device token's two budgets, both counted inside
`auth_enter_device` with their numbers as constants (migration `0009`, principle 7): reads of one
class's document (`GET /api/player/classes/{class_id}`) towards 600 a minute, everything else
(pages, the cursor, the device's own routes) towards 60 a minute. `device_token` names the
budget from the route it was matched to (`bearer_policy.budget_of`) in the transaction-local
setting `app.device_budget`, which the function reads and clears; any other value is the 60.
A refused request keeps its count and "last used". Nothing else is written. `after`,
`limit` and `class_id` are taken as raw text and parsed by `sync_policy.py` (ASCII digits only;
a class id only in its canonical 8-4-4-4-12 form), so a malformed one is refused by the route
with `422 invalid_request` and still counts: a value the framework refused would be refused
inside the device token's transaction and roll back its count.

## Request bodies (ADR 0002, section 10)

Every body is held to 16 KiB (`body_policy.py`) by the middleware `BodyCap` (`body_cap.py`),
inside the access log and outside every route: a `Content-Length` over the cap is answered
`413 body_too_large` before the app sees the request, and a body sent without one is counted as
it is read and refused at the read that goes over. The rest is never read. A route reads its
body before its credential (`tests/guards/test_guard_body_order.py`), so the 413 comes before any
credential is looked at or any transaction is opened. The one exception is
`POST /api/source/publications`, which reads its own body no further than 2 MiB and refuses an
oversized one inside the source token's transaction, so that it counts as the token's use while
a slow upload still holds no pool connection.

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
| `POST /api/source/publications` (ADR 0003, section 6) | `Authorization: Bearer cbp_src_…` | `200 {status: applied or repeat, highest_publication_number}`; `409 stale_publication` or `publication_conflict` with `highest_publication_number`; `409 too_many_classes` at 2,000; `422` (`invalid_publication`, `content_hash_mismatch`, `unsupported_format_version`); `413 document_too_large` over 1 MiB (a body over 2 MiB is not read further), answered inside the token's transaction, so it counts |
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

## Export and account deletion (ADR 0002, sections 10, 11 and 12)

| Route (all under `/api/site/`) | Does |
|---|---|
| `POST account/export` | `200`, a JSON download (`Content-Disposition: attachment`) streamed for this request: the account's email and creation time, its classes with their documents and removal markers, devices, source links, passkey names, sessions and audit events. No hash, token, key, account id or passkey user handle. Writes `account.exported` first, so the export holds its own event. `429` over 3 a day per account |
| `POST account/delete` `{confirm}` | `confirm` is the account's email as typed (case and surrounding spaces aside); anything else is `422 confirmation_mismatch`. `204`, and the cookie is cleared. Writes no event |

- Both need a sign-in within the last 10 minutes (`403 recent_sign_in_required`) and are
  POSTs, so the origin check applies. A refusal keeps the session's "last used".
- The deletion is one statement in the request's transaction: the account row, and by cascade
  every row with its owner column (`account_id`): sessions, passkeys and registrations,
  devices, approved pairings, source links and link codes, classes and markers, the sync
  cursor and audit events. From the next request on, its sessions are `401 not_signed_in` and
  its device and source tokens `401 token_unknown`; the app forgets a device token on
  `token_unknown`. What has no owner column stays until it expires: pending sign-in links for
  the address (15 minutes) and counters, which hold hashes only. The operator's allowlist is
  not changed.
- The export count is kept by `rate_limit_hit` under a hash of the account id, with the
  number passed in like the source API's: it bounds a client, not the backend's role.
- The export is streamed. The checks, the count and the event commit with the request; the
  account's small parts come first, then its classes, read in sync order a page of 16 at a
  time, each page in its own short transaction that enters the session again. If the session
  has ended or the account is gone before a page, the stream stops there and the download is
  not valid JSON. No connection is held between pages.

## Live re-check and revocation notices (ADR 0002, section 8; ADR 0005, section 2)

- Migration `0013` gives `auth_device_active` and `auth_session_active` their bodies, the live
  process's re-check every 30 seconds. Each answers true exactly when `auth_enter_device` would
  answer `ok` (before its budget) or `auth_enter_session` would find the session, with the same
  lifetimes as constants in the SQL (principle 7): not revoked, used within 180 days, used once
  or paired within 24 hours; used within 14 days, created within 60 days. Neither sets the
  account, writes "last used", counts a budget or writes an event
  (`tests/test_live_check_functions.py`).
- The transactions that revoke a device (on the site or by the app itself), end one session,
  sign out everywhere or delete the account call `revocation.notify` after their write:
  `pg_notify('live_revocations', <account id>)`. PostgreSQL sends it only at commit, once per
  transaction; a refused or rolled-back one sends none. The notice is a hint with no authority;
  the live process answers it with the re-check (`tests/test_revocation_notices.py`). No advisory
  lock is taken.

## Live sessions (ADR 0002, section 8; ADR 0005, sections 2 and 6)

| Route | Credential | Does |
|---|---|---|
| `POST /api/live/sessions` | `Authorization: Bearer cbp_dev_…` | `200 {sessionId, joinCode, hostToken}` (`schema/live/v1/session-answer`). The device's earlier session ends first. `409 sessions_full` with 3 sessions on other devices of the account. The device token's refusals are the player API's (401 `invalid_token`, `token_unknown`, `token_expired`, `token_revoked`; 429) |

- The sessions live in the one backend process's memory only (`live/registry.py`): the account,
  the device, the hash of the device token that started it, the hash of the host token, the join
  code and the times. The host token is given out once, in the answer. Nothing is written to a
  log but the event's name and the reason.
- Lifetimes (`live_session_policy.py`): 15 minutes without a host connection (from the start,
  while the host has never connected), 12 hours at most. A session the re-check could not confirm
  for 90 seconds (3 rounds the database did not answer) ends too: the live process fails closed.
- The re-check (`live/service.py`, `live/recheck.py`): one thread, a listening connection of its
  own on `live_revocations` (`db/live.py`, `db/executor/_listen.py`). A notice re-checks that
  account's sessions at once; every 30 seconds all of them; when the listening connection is lost
  it is opened again after 1, 2, 4, 8, then every 15 seconds and every session is re-checked at
  once. A device not active ends its session (`revoked`); a site session not active drops the
  controller it signed in, and the session goes on.
- The listening connection uses `PLAYER_DATABASE_URL`, like the pool, and needs a session-level
  connection: behind a transaction pooler (which does not keep `LISTEN`) it would need a separate
  listener URL that reaches PostgreSQL directly. There is no such setting yet.
- Audit: `live.session_started` in the start's transaction; `live.session_ended` (with the reason:
  `host_ended`, `replaced`, `host_away`, `lifetime`, `unconfirmed`) after `auth_enter_device`
  with the session's stored hash, so nothing is written once the device is revoked or the account
  is gone. Details hold the session id and the reason only. An end that is not recorded (the
  device over its request budget, `limited`, or no longer working) is logged as
  `live.end_not_recorded` with that state; a log names an event, a reason, a state or an error
  type, never a token, code or hash.
- `live_token_policy.hello_role`: the WebSocket's `hello` (#170) gives `cbp_hst_` the host's role
  and `cbp_ctl_` the controller's; a rider token gets none (no rider route in this part of PL8).
- `create_app(..., live_recheck=None)` runs no re-check loop; the tests use it so, except
  `tests/test_live_recheck.py`.

## The companion page at `/control` (ADR 0005, section 8)

- `control_page.py` serves the web lane's build, `web/dist/control/` next to `backend/` (`npm run
  build` in `web/`), at `/control`: `index.html` at `/control` (and `/control/`) only, its
  scripts, style sheets and fonts under `/control/`. `create_app(..., control_dir=...)` points
  it elsewhere. The files are read once when the app is made; without a build, `/control` is a
  404 and a warning is logged.
- Only `.js`, `.css` and `.woff2` files with plain lower-case names, at most one folder deep,
  are served (`control_page_policy.asset_type`); no symbolic link is followed. A request is
  answered by exact lookup in that table: any other path under `/control` is
  `404 {"error": "not_found"}` and never reaches another route or file.
- Every answer under `/control` carries `control_page_policy.control_headers`: a content
  security policy with `default-src 'none'`, the page's own origin for its scripts, styles and
  fonts, and `connect-src` limited to `/api/live/`, `/api/site/sessions` and the live WebSocket
  `wss://…/api/live/ws`; `frame-ancestors 'none'` and `X-Frame-Options: DENY`;
  `Referrer-Policy: no-referrer`; `X-Content-Type-Options: nosniff`; `Cache-Control: no-store`
  on the page and `no-cache` on its assets.

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
