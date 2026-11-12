# ADR 0002: Accounts, sign-in, pairing and tokens

## Status

Accepted, 2026-11-12, by the Orchestrator under the frozen [plan](../plan.md). Revisable: a
change is a new ADR or an amendment in a docs pull request, reviewed like this one.

## Context

The plan gives the backend its own accounts, a class library per account, paired devices, a
source API for classbeat and, later, live sessions (plan sections 5, 6 and 7). It fixes these
points, which this ADR takes as given:

- Sign-in is an email link plus passkeys. No passwords (decision 5, recommended option, the
  working default under plan section 13).
- A device is paired with a short code and gets a read-only token. The token is stored hashed on
  the server and in the operating system's keychain on the device.
- A source gets a token that can only write one user's classes. A class arrives as a publication
  with a number the source increases. Stale numbers are refused. A removal is a publication too.
- Every row belongs to an account and is read through that account's context, enforced in the
  database as well as in the code.
- Riders in a live class need no account. Rider data goes from the rider to the instructor only
  (rule 13). The join code carries a session identifier only (rule 14). Controlling a class needs
  the instructor's sign-in or a one-time code shown only on the instructor's screen (section 3).
- Live sessions run in one process and keep their state in memory (section 5).
- Python 3.12, FastAPI, PostgreSQL 17.

The plan leaves the rest to agents: formats, lengths, lifetimes, limits, the database mechanism
and the message rules. PL2 builds accounts, pairing and the source API on this ADR. PL8 builds
live sessions on it.

Words used below. The **site** is the product's website and its API, on one origin. The **app**
is the desktop player. A **source** is a product that sends classes, first classbeat. The **host**
is the app that runs a live session.

## Decision

### 1. Principles

1. Every secret the server issues is random, has a prefix that names its type, and is stored on
   the server only as a hash. The clear value is shown or sent once.
2. Every credential has one scope. An endpoint accepts one credential type and refuses the rest
   by prefix, before any lookup.
3. No secret is ever put in a URL path or query string, a log line, an audit event or an error
   message.
4. Tenant isolation is done twice: in the code and in the database.
5. What a role may receive in a live session is an allowlist. Nothing is sent by default.
6. All numbers below are settings with these values as defaults.

### 2. Token format and hashing

**Long tokens** are `cbp_<type>_<secret>`:

- `<secret>` is 32 bytes from the operating system's random source (`secrets.token_bytes(32)`),
  written as base64url without padding: 43 characters, 256 bits.
- `<type>` is one of `ml`, `ses`, `dc`, `dev`, `lc`, `src`, `ctl`, `rdr` (table in section 3).
- The pattern `cbp_[a-z]{2,3}_[A-Za-z0-9_-]{43}` recognises a leaked token. CI searches the
  repository for it and fails on a match. Tests build their tokens at run time.
- `cbp` comes from the working name. If the name changes (decision 12), new tokens get a new
  prefix and old ones stay valid.

**Short codes** are for people to read and type:

- 8 letters from the 20-letter alphabet `BCDFGHJKLMNPQRSTVWXZ` (no vowels, no digits), shown as
  `XXXX-XXXX`. That is 20^8, about 2.6 × 10^10 values.
- Input ignores case, spaces and hyphens.
- Short codes are always short-lived, single-purpose and rate-limited. None of them is enough
  alone to read stored data.

**Hashing.** The server stores `SHA-256(token string)` as 32 bytes in a column with a unique
index, and looks a token up by that hash. A slow password hash is not used: the tokens have 256
bits of entropy, so guessing is not possible and a fast hash keeps every request cheap. Short
codes kept in the database are stored the same way. A short code's hash can be reversed by trying
every code. That is accepted, because the pairing code alone collects nothing (section 6).

### 3. Token types

| Type | Issued by, when | Scope | Lifetime | Server storage | Client storage | Revoked by |
|---|---|---|---|---|---|---|
| Email link token `cbp_ml_` | Site, on a sign-in request | Finish one sign-in for one email, in the browser that asked | 15 minutes, single use | Hash, in `login_links` | In the mail only; read from the URL fragment | Use, expiry, a newer link for the same email |
| Session token `cbp_ses_` | Site, on sign-in by link or passkey | The site's API for one account | 14 days idle, 60 days absolute | Hash, in `sessions` | Cookie `__Host-cbp_session` | Sign out, "sign out everywhere", account deletion, expiry |
| Pairing device code `cbp_dc_` | Site, when the app starts pairing | Collect one device token for one pending pairing | 10 minutes, single use | Hash, in `pairings` | App memory only | Use, expiry, denial on the site |
| Pairing user code (short) | Same call | Lets a signed-in user approve that pending pairing | 10 minutes, single use | Hash, in `pairings` | Shown on the app's screen | Use, expiry |
| Device token `cbp_dev_` | Site, on the first poll after approval | Read one account's classes and changes; host live sessions for that account. No write to stored data | No fixed end; ends after 180 days without use | Hash, in `devices` | Operating system keychain | The user on the site, account deletion, idle expiry; the app can revoke its own |
| Source link code `cbp_lc_` | Site, when the user approves a link | Exchange once for a source token | 60 seconds, single use | Hash, in `source_link_codes` | In the redirect to the source | Use, expiry |
| Source token `cbp_src_` | Site, on the code exchange | Publish and remove classes for one account; read its own publication numbers. Reads no class content, devices or account data | No fixed end; ends after 365 days without use | Hash, in `source_links` | Encrypted in the source's own store | The user on the site, the source itself, account deletion, idle expiry |
| Join code (short) | Live process, when a session starts | Names one live session; lets a phone ask to join as a rider | The session | Memory of the live process | On the room screen and in the QR code | Session end; the host can lock the session or make a new code |
| Control code (short) | Live process, when the host asks | Exchange once for a controller token for that session | 2 minutes, single use | Memory | On the instructor's screen only | Use, expiry, 5 wrong tries, a newer code |
| Controller token `cbp_ctl_` | Live process, for a control code or the instructor's session | Steer and follow one live session | The session | Hash, in memory | Phone, `sessionStorage` | The host drops the controller; session end |
| Rider token `cbp_rdr_` | Live process, on a join | Follow one live session and send that rider's own data to its host | The session | Hash, in memory | Phone, `sessionStorage` | The host removes the rider; session end |

Passkeys are not tokens. The server stores only the public key (section 4).

### 4. Accounts and sign-in

**Account.** One row in `accounts`: a UUID, the email (trimmed and lower-cased, unique, at most
254 characters), a random 32-byte passkey user handle, and dates. The account id is the tenant
key everywhere. A later gym account that groups instructors adds a membership table and does not
change this key.

**Who can sign up.** Sign-up and sign-in are the same flow: the first sign-in for an email
creates the account. The setting `SIGNUP_MODE` is `allowlist`, `open` or `closed`. The default is
`allowlist`: only emails on a list kept by the operator can create an account. This is the safest
reversible default. Who is let in is settled in the provider-terms ADR and by the owner.

**Email link.**

1. The user enters an email. The answer is always the same ("if this address can sign in, a link
   is on its way"), whether or not the address is known or allowed.
2. The site stores the hash of a new `cbp_ml_` token with the email, and sets a cookie
   `__Host-cbp_login` holding a random 32-byte value whose hash is stored with the link. A newer
   link for the same email cancels older ones.
3. The mail holds `https://<site>/sign-in#<token>`. The token is in the fragment, so it never
   reaches a server log, a proxy or a `Referer` header.
4. The page reads the fragment and shows a "Sign in" button. Pressing it sends the token in the
   body of a POST. A mail scanner that opens the link uses nothing up.
5. The server accepts the token once, within 15 minutes, and only with the matching
   `__Host-cbp_login` cookie. A link opened in another browser is refused with a message to ask
   for a new link from that browser. So a forwarded or stolen mail does not sign anyone in.
6. On success the account is created if needed, a session is issued and the link row is deleted.

**Passkeys (WebAuthn).**

- The relying-party id is the site's host name and the origin must match exactly. Both come from
  one setting, because the domain is the owner's (decision 10).
- Registration needs a signed-in session with a recent sign-in. Discoverable credentials, user
  verification required, attestation `none`, algorithms ES256, EdDSA and RS256.
- Stored per passkey: credential id, public key, signature counter, transports, a name, dates.
  At most 10 per account.
- A challenge is 32 random bytes, single use, valid 5 minutes, stored server-side and bound to
  the `__Host-cbp_login` cookie.
- A signature counter that goes backwards from a non-zero value refuses the sign-in and writes an
  audit event.
- The email link stays as the way back in when a passkey is lost. So the account is as safe as
  the mailbox. This is the plan's choice.

**Recent sign-in.** A session records when the user last proved who they are. Adding or removing
a passkey, export, account deletion and "sign out everywhere" need that within the last 10
minutes. Otherwise the user signs in again by passkey or link.

Changing the email address is not part of PL2. When it is added it gets its own review.

### 5. Sessions on the site

- Cookie `__Host-cbp_session=<cbp_ses_ token>`; `Secure`; `HttpOnly`; `SameSite=Lax`; `Path=/`;
  no `Domain`. `Max-Age` equals the absolute lifetime.
- A new token is issued at every sign-in. A token from before sign-in is never upgraded.
- Lifetime: 14 days without use, 60 days in total. "Last used" is written at most once every 5
  minutes. At most 20 sessions per account; the oldest is dropped.
- Revocation deletes the row, so it takes effect on the next request. The site lists sessions
  (browser family, last used) and can end one or all.
- Cross-site requests. Every state change is a POST, PUT, PATCH or DELETE. For those the server
  requires an `Origin` header equal to the site's origin, and refuses the request when
  `Sec-Fetch-Site` is present and is not `same-origin`. No cross-origin resource sharing is
  enabled for the cookie API.
- The session cookie is accepted only by the site's API. The player, source and live APIs ignore
  cookies and take a token in `Authorization: Bearer`, or in the first WebSocket message
  (section 8). So a cross-site request can never use the cookie against them.
- Responses that carry a token have `Cache-Control: no-store`. The site sends
  `Referrer-Policy: no-referrer`.

### 6. Pairing a device

The shape is the OAuth device flow (RFC 8628), with our own endpoints.

1. The app calls `POST /api/pairing/start` with its platform and version. It gets a device code,
   a user code, the address of the pairing page, `expires_in: 600` and `interval: 5`.
2. The app shows the user code and opens `https://<site>/pair` in the browser. The code is not
   in the address. The signed-in user types it.
3. The page shows the platform and version the request came from and asks the user to confirm
   only if the code is on their own player's screen right now. The user names the device (1 to
   40 characters) and confirms with a POST. They may also deny.
4. The app polls `POST /api/pairing/token` with the device code every 5 seconds. Answers:
   `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, or success.
5. On the first poll after approval the server, in one transaction, creates the device token,
   stores its hash in `devices`, marks the pairing used and returns the token with the account's
   email. The clear token is never stored. A second poll gets `expired_token`.
6. The app shows the email of the account it joined and saves the token in the keychain.

Limits: a pairing lives 10 minutes. A user gets 5 wrong codes in 15 minutes, then the form is
closed for 15 minutes. An address may start 10 pairings an hour. At most 10 active devices per
account.

The user code can only attach the waiting device to the account of whoever confirms it. Only the
holder of the device code, which never leaves the app, collects the token. So a guessed user code
gives the guesser nothing.

**The reverse direction** (a code shown on the site and typed into the app) is not built. One
direction is enough, and the plan describes this one.

**The device token.**

- Sent as `Authorization: Bearer`. The app refuses a server address that is not HTTPS, except
  loopback in development.
- Scope: the player API (classes, removals, cursors) for its account, and hosting live sessions
  for that account. "Read-only" means it changes no stored data: live sessions are not stored.
- On the device it is kept in the operating system's secret store (Keychain, DPAPI, Secret
  Service). If none is available the token is kept in memory for that run and not written to
  disk.
- A shared studio computer holds one device token per paired account, each its own keychain
  entry and its own cache. Switching account is local.
- The site lists devices: name, platform, paired date, last used. Revoking one sets
  `revoked_at`. The row is kept 90 days so the server can answer `token_revoked`, then deleted.
- When the server answers 401 with `token_revoked` or `token_unknown`, the app deletes that
  account's cached classes and the token, after any class being played has ended. It never does
  so on a network error or a 5xx answer.
- A paired device sends the user a mail ("a new device was paired"). So does a new source link
  and a new passkey.
- The token is not rotated (see Alternatives).

### 7. The source API

**Linking.** The shape is the OAuth authorization-code flow with PKCE and no client secret.

1. Known sources are a setting: an id (`classbeat`), a display name and the exact redirect
   addresses allowed.
2. The source sends the user's browser to `https://<site>/link/source` with `source`,
   `redirect_uri`, `state` and `code_challenge` (S256). An unknown source or redirect address is
   refused without redirecting.
3. The signed-in user sees which product asks and what it may do, and approves with a POST.
4. The site redirects back with a `cbp_lc_` code and the `state`. The code lives 60 seconds and
   works once.
5. The source's server calls `POST /api/source/token` with the code and the `code_verifier`, and
   gets the source token once.

At most 5 links per account. The site lists them (source, linked date, last used) and can revoke
each. The source can end its own link with `DELETE /api/source/link`. Revoking a link keeps the
classes: they belong to the account.

**Publications.** `POST /api/source/publications` with the source token and a body of
`source_class_id`, `publication_number`, `kind` (`class` or `removal`), and for a class
`content_hash` and `document`.

- A class is keyed by account, source id and `source_class_id`. The source id comes from the
  token, never from the body. A new link to the same source continues the same numbers.
- `publication_number` is an integer from 1 to 2^63 − 1.
- The server computes the content hash of the document itself, by the rule in the class-format
  ADR, and refuses a document whose hash differs from `content_hash` (422).
- The decision is made in one transaction that locks the class's row:

| Incoming number against the highest seen | Result |
|---|---|
| Higher | Applied. The class or the removal is stored and the account's sync cursor moves. `200 applied` |
| Equal, same kind and same hash | A repeat. Nothing changes. `200 repeat` |
| Equal, different kind or hash | `409 publication_conflict` |
| Lower | `409 stale_publication`, with the highest number seen |

- A removal deletes the document at once and leaves a marker: account, source id, class id, the
  number and the time. No title, no content. The marker stays as long as the account, so a late
  send of older content can never bring the class back. A later, higher-numbered `class`
  publication stores the class again: that is the user sending it again.
- Deleting a class on the site writes the same marker at the highest number seen.
- A source that lost its counter reads the highest number from the 409 answer or from
  `GET /api/source/classes/{id}` (numbers only) and continues above it.
- Limits: a document is at most 1 MiB, an account holds at most 2,000 classes, a token may send
  60 publications a minute.

### 8. Live sessions (PL8)

All `/api/live/` routes, HTTP and WebSocket, are served by the one live process (plan section
5). Sessions, codes and live tokens exist only in its memory. Nothing about riders is written to
the database or to logs.

**Roles.**

| Role | Who | Proves it with | May |
|---|---|---|---|
| Host | The app running the class | The account's device token | Start, lock and end the session; publish the clock and class state; make codes; drop controllers and riders |
| Controller | The instructor's phone (handlebar companion) | A controller token | Receive the clock, the cue and what is next; send start, pause, skip and nudge to the host |
| Rider | A rider's phone | A rider token | Receive the clock and class state; send their own nickname and readings to the host |

**Starting.** The host calls `POST /api/live/sessions` with its device token and gets a session
id and a join code. At most 3 live sessions per account. A session ends when the host ends it,
15 minutes after the host's connection is lost, or after 12 hours.

**Joining as a rider.** The room screen shows the join code and a QR code of
`https://<site>/j/<code>`. That address carries the code and nothing else: no account, class,
instructor or tracking value (rule 14). The phone calls `POST /api/live/join` with the code and
a nickname, and gets a rider token. A nickname is 1 to 24 characters with control characters
removed, is always rendered as text, and is gone when the session ends. At most 60 riders per
session. The rider's FTP and maximum heart rate stay on the phone (plan section 7).

**Becoming a controller.** Two ways, as the plan says, and never the join code:

- The instructor is signed in on the phone with the account that hosts the session, and calls
  `POST /api/live/sessions/{id}/controller` (a normal site request with the checks of section 5).
- The host asks for a control code. It is shown on the instructor's screen only, never on the
  room screen. The phone exchanges it at `POST /api/live/control`.

Either way the phone gets a controller token. At most 2 controllers per session.

**WebSocket sign-in.** One endpoint, `wss://<site>/api/live/ws`.

- No token in the address and no cookie is used. The first message must be
  `{"type":"hello","token":"<token>"}` and must arrive within 5 seconds. Otherwise the server
  closes with code 4401. The token's prefix gives the role; the token gives the session.
- For controller and rider tokens the handshake's `Origin` must be the site's origin.
- Before `hello`, a connection may send one message of at most 1 KiB. After it, a message is at
  most 16 KiB and a connection may send 10 messages a second. Breaking a limit closes the
  connection.
- When a token is revoked or the session ends, the server closes its connections with code 4403.

**Routing is an allowlist, decided by the server.**

| Message | From | Delivered to |
|---|---|---|
| Clock and class state (time, interval, what is next) | Host | Riders, controllers |
| Coaching cue | Host | Controllers |
| Control command (start, pause, skip, nudge) | Controller | Host |
| Rider nickname, presence and readings | Rider | Host |
| Session ended, removed, locked | Server | The connection concerned |

- Anything not in the table is dropped and counted.
- There is no path from a rider to a rider, and none from a rider to a controller. If the
  handlebar companion should ever show rider data, that is a new, reviewed change.
- A rider receives no roster, no rider count, no nickname and no reading of anyone else.
- The messages the server sends to riders have their own schemas in the contract lane, closed to
  extra fields, and contain no field derived from a rider. A rule guard test checks this
  (AGENTS.md, section 6).
- In the code, the function that sends to riders accepts only those host-to-rider types.
- The server relays rider readings to the host and keeps nothing.

### 9. Tenant isolation

**Roles in PostgreSQL.**

| Role | Used for | Rights |
|---|---|---|
| `player_owner` | Migrations only | Owns the schema and tables |
| `player_app` | The running backend | `NOSUPERUSER`, `NOBYPASSRLS`, owns nothing; `SELECT`, `INSERT`, `UPDATE`, `DELETE` on tables |
| `player_auth` | Owner of the lookup functions | `NOLOGIN`, `BYPASSRLS` |

**Tables.** Every table that holds an account's data has `account_id uuid NOT NULL REFERENCES
accounts(id) ON DELETE CASCADE`, row-level security enabled **and forced**, and this policy:

```sql
CREATE POLICY tenant ON <table>
  USING      (account_id = nullif(current_setting('app.account_id', true), '')::uuid)
  WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);
```

With no account set the expression is null and no row is visible or writable. `accounts` has the
same policy on its `id`.

**Setting the account.** Each request runs in one transaction that starts with
`SELECT set_config('app.account_id', $1, true)`. The value is local to the transaction, so a
pooled connection never carries one request's account into the next. It is never set at session
level.

**Before the account is known.** A token must be looked up before there is an account. This is
done only through a small, fixed set of `SECURITY DEFINER` functions owned by `player_auth`, with
`search_path` pinned, `EXECUTE` revoked from `PUBLIC` and granted to `player_app`. Each takes a
32-byte hash (or an email, or a passkey credential id) and returns at most one row with the
least it must: the account id, the row id, the expiry. So the running backend can find a
credential only by presenting its hash. One more such function deletes expired rows.

**Tables without an account.** `login_links`, `pairings` before approval, passkey challenges and
rate-limit counters exist before any account. They hold no account's content. They are on a
short written allowlist.

**In FastAPI.** One dependency resolves the credential, opens the transaction, sets the account
and yields an `AccountContext`. Data access takes that context and nothing else hands out a
database connection. Queries still filter by `account_id` in the code; the policy is the
backstop.

**Guard tests** (never weakened):

- Every table in the schema has row-level security enabled and forced and has the tenant policy,
  unless it is on the allowlist. The test lists tables from the catalogue, so a new table fails
  until it complies.
- `player_app` is not a superuser, cannot bypass row-level security and owns no table.
- With two accounts, every endpoint is called as one and can neither read nor change the
  other's rows. The same is checked directly in SQL as `player_app`, with the other account set
  and with none set.

### 10. Rate limits

Counters are fixed windows in a PostgreSQL table, so several API processes share them. Keys are
hashes (an email is never stored in a counter). The client address is taken from the proxy
header only when the request comes from a configured trusted proxy. A refused request gets 429
with `Retry-After`.

| What | Limit |
|---|---|
| Sign-in link requests | 3 per email per 15 minutes, 10 per email per day, 10 per address per hour |
| Failed passkey sign-ins | 10 per address per 10 minutes |
| Pairing starts | 10 per address per hour |
| Pairing polls | One per 5 seconds per device code; faster gets `slow_down` |
| Wrong pairing codes | 5 per account per 15 minutes |
| Source code exchanges | 10 per address per minute |
| Publications | 60 per source token per minute |
| Player API requests | 60 per device token per minute |
| Unknown or revoked bearer tokens | 20 per address per 5 minutes, then that address is refused for 5 minutes |
| Live joins | 10 per address per minute |
| Wrong control codes | 5 per session, then the code is cancelled |
| WebSocket connections | 30 per address per minute; 20 waiting for `hello` per address |
| Account exports | 3 per account per day |

### 11. Audit events

One table, `audit_events`, owned by the account like any other: time, event name, the kind and id
of the credential that acted, the client address shortened to its network (/24 or /48), the
browser or app family, and a small detail object.

Events: sign-in link requested; signed in (link or passkey); sign-in refused; signed out; all
sessions ended; passkey added, removed or refused; pairing approved or denied; device revoked;
device token refused as revoked; source linked or revoked; publication applied, refused as stale
or as a conflict; class deleted on the site; live session started or ended; controller added;
export made; account deletion.

An event never holds a token, a code, a hash, a class title, a nickname or a rider's reading.
Events are kept 180 days, are part of the export and go with the account. Logs follow the same
rule: the `Authorization` and `Cookie` headers and request bodies of token endpoints are never
logged.

### 12. Export and deletion

- **Export** needs a recent sign-in. It is a JSON archive streamed straight to the browser: the
  account, the class documents, devices, source links, passkey names, sessions and audit events.
  No hash, token or key is in it. Nothing is stored on the server and there is no download link.
- **Deleting a class** removes its document at once and leaves the marker of section 7.
- **Deleting the account** needs a recent sign-in and a typed confirmation. One transaction
  deletes the account row and, by cascade, everything owned by it: classes, markers, devices,
  source links, sessions, passkeys and audit events. Its live sessions are ended. Every token of
  the account stops working at once. Each device gets `token_unknown` at its next contact and
  wipes that account's cache.
- Rate-limit counters hold only hashes and expire with their windows.
- Backups and how long they are kept belong to the deploy runbook (PL7).

### 13. Threats and answers

| Threat | Answer |
|---|---|
| **A stolen device token** | It is read-only on stored data and reaches one account's classes only. It cannot read the account, its devices or its sources, cannot publish and cannot reach the site's API. The user sees the device and its last use on the site and revokes it; that takes effect on the next request. It ends after 180 days without use. On the device it sits in the operating system's secret store, never in a plain file. It can host a live session for that account, which stores nothing |
| **A guessed pairing code** | 2.6 × 10^10 values, 10 minutes, 5 wrong tries per account per 15 minutes, and a signed-in session is needed to try at all. A hit only attaches someone else's waiting device to the guesser's own account; the token goes to the holder of the device code. The app shows which account it joined |
| A pairing code pushed on a user by an attacker | The code is typed, never in a link. The page says to confirm only a code on the user's own screen and shows the asking platform. A mail tells the user a device was paired. The token is read-only and revocable |
| **A guessed join code** | Same code space; 10 joins per address per minute. A hit makes the guesser a rider in a stranger's class: they receive the clock and class state, never anyone's data. The host sees them, can remove them, lock the session or make a new code. At most 60 riders |
| A guessed control code | Shown on the instructor's screen only, 2 minutes, single use, cancelled after 5 wrong tries. A controller can only start, pause, skip and nudge; the host can drop it |
| **A replayed publication** | Needs the source token. The same number and hash is a repeat and changes nothing. The same number with other content is refused |
| **An out-of-order publication** | A lower number is refused as stale. The check and the write are one transaction under a row lock, so two sends cannot cross. Markers of removed classes keep their number, so old content cannot return |
| A stolen source token | It writes classes for one account and reads nothing but publication numbers. The user or the source revokes it. Publications are audited. It ends after 365 days without use |
| **One account reading another's rows** | Queries filter by account in the code. Row-level security, forced, with a role that cannot bypass it, refuses the rest. The account is set per transaction. Guard tests cover every table and every endpoint |
| **A rider reaching another rider's data** | The server has no route from rider to rider. Messages to riders are closed schemas with no rider-derived field. Riders get no roster or count. A rider token is tied to one session and one rider. Nothing about riders is stored. A rule guard test holds this |
| A stolen session cookie | `HttpOnly`, `Secure`, `__Host-`. Sensitive actions need a recent sign-in. Sessions are listed and can be ended. 14 days idle, 60 days in total |
| A forwarded, intercepted or pre-opened sign-in link | Single use, 15 minutes, bound to the browser that asked, token in the fragment, used only by a POST |
| Finding out who has an account | Sign-in requests always answer the same |
| Cross-site requests and cross-site WebSocket use | `SameSite=Lax`, the `Origin` check, no cross-origin sharing. The WebSocket takes no cookie and checks `Origin` for browser roles |
| A token in a log, a link or a public repository | Tokens are never in an address. Headers and token bodies are not logged. The prefix makes a leak findable; CI scans for it |
| A copy of the database | It holds hashes of 256-bit tokens, which cannot be reversed, and public keys. Live codes and tokens are not in it |
| Injected SQL running as the backend's role | That role cannot bypass row-level security, owns nothing and can find a credential only by its hash |
| Hostile text in a nickname or a device name | Length limits, control characters removed, always rendered as text |
| A flood of requests or connections | The limits of section 10 and the message limits of section 8 |

## Alternatives

- **Passwords.** Ruled out by the plan: nothing to store, nothing to leak.
- **Sign in with a classbeat account.** The other option of decision 5. It ties the two
  products together. Not the default.
- **Signed self-contained tokens (JWT).** They cannot be revoked at once without a server-side
  list, which is the lookup we already have. They also need signing keys to manage. Opaque
  tokens with a hash lookup are simpler here.
- **A slow hash or a keyed hash for tokens.** A slow hash protects weak secrets; ours have 256
  bits. A keyed hash adds a server key to protect and rotate, for no gain with secrets this
  long.
- **Rotating device tokens.** A lost answer during rotation locks out a studio computer that
  may be offline for weeks. Revocation, the idle limit and the narrow scope are used instead.
- **The pairing code in the link the app opens.** One step less for the user, but it lets an
  attacker send a ready-made link. Typing the code is the safer default.
- **A shorter join code (6 letters).** Easier to read from the back of a room. Most riders scan
  the QR code, so one code format for everything was preferred.
- **WebSocket sign-in by cookie, by a token in the address, or by a one-time ticket.** A cookie
  opens cross-site use. An address ends up in logs. A ticket works but adds a call and a store.
  The first-message token needs neither.
- **Tenant isolation in the code only.** One forgotten filter would leak. The plan asks for the
  database as well.
- **A schema or a database per account.** Strong, but heavy to migrate and to pool for many
  small accounts.
- **Token lookups through a policy on the hash instead of functions.** Possible, but it spreads
  the exception over many policies. A few named functions are easier to review.
- **Storing live sessions in the database.** Not needed for one process, and it would store
  rider data. The plan keeps them in memory.

## Consequences

- PL2 can be built from this document: tables, roles, endpoints, limits and guard tests are
  named. PL8 adds the live part without changing the rest.
- The backend sends mail (sign-in links and notices). Tests use a fake. A real mail service is
  the owner's to choose before the first deploy.
- The database needs three roles, created by the database's init script, and a role allowed to
  create a `BYPASSRLS` role once.
- An account is as safe as its mailbox, because the email link is the way back in.
- Sign-in by link works only in the browser that asked for it. A user who opens the mail on
  another device asks again there.
- Anyone at a shared studio computer can open the classes of every instructor paired on it.
  The token there is read-only. A local lock is not part of this design.
- A device that was offline for more than 180 days is paired again.
- Restarting the live process ends every live session. The room screen does not depend on it.
- Riders see nothing of each other, not even how many they are. The handlebar companion shows
  no rider data.
- The limits are settings. Raising one is a normal change; removing a guard test is not.
- Defaults chosen here that the owner may want to change: the `cbp_` prefix (follows the name,
  decision 12); sign-up by allowlist; the session lifetimes; client addresses shortened in audit
  events.
