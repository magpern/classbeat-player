# 0002. Accounts, sign-in, pairing and tokens

Status: Accepted (2026-11-12), by the Orchestrator under the frozen [plan](../plan.md).
Revisable: a change is a new ADR or an amendment in a docs pull request, reviewed like this one.

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
live sessions on it. The publication envelope and the content hash are defined in
[ADR 0003](0003-class-format.md).

Words used below. The **site** is the product's website and its API, on one origin. The **app**
is the desktop player. A **source** is a product that sends classes, first classbeat. The **host**
is the app that runs a live session. The **live process** is the one backend process that serves
live sessions.

## Decision

### 1. Principles

1. Every secret the server issues is random, has a prefix that names its type, and is stored on
   the server only as a hash. The clear value is shown or sent once.
2. Every credential has one scope. An endpoint accepts one credential type and refuses the rest
   by prefix, before any lookup.
3. No token or code is put in a URL path or query string, with one exception: the source link
   code in the redirect back to the source (section 7), as the authorization-code flow requires.
   It lives 60 seconds, works once and is useless without the PKCE verifier. Where a link must
   carry a token or a code (the sign-in mail, the join QR code, the control QR code), it is in
   the URL fragment, which is never sent to a server.
4. No token, code or hash is written to a log line, an audit event or an error message. That
   holds for the database's log too (section 11).
5. Tenant isolation is done twice: in the code and in the database.
6. What a role may receive in a live session is an allowlist. Nothing is sent by default.
7. All numbers below are settings with these values as defaults. A setting that bounds what
   the backend's role can do is held by the database, not passed in by the backend. That
   covers `SIGNUP_MODE`, `LOGIN_LINK_SAME_BROWSER` and the limits counted inside the `auth_*`
   functions, and the other numbers those functions use: the link's 15 minutes, the session
   lifetimes and the cap of 20 sessions. Passing one in from `player_app` would undo the bound
   in section 9. Such a setting is a constant in the function's body and is changed by a
   migration (amended 2026-11-12).

### 2. Token format and hashing

**Long tokens** are `cbp_<type>_<secret>`:

- `<secret>` is 32 bytes from the operating system's random source (`secrets.token_bytes(32)`),
  written as base64url without padding: 43 characters, 256 bits.
- `<type>` is one of `lgn`, `ml`, `ses`, `dc`, `dev`, `lc`, `src`, `hst`, `ctl`, `rdr` (table in
  section 3).
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
| Browser token `cbp_lgn_` | Site, when a browser starts a sign-in | Ties a sign-in link or a passkey sign-in challenge to the browser that asked. Signs nobody in | 1 hour | Hash, with the link or the challenge | Cookie `__Host-cbp_login` | Expiry; replaced at the next sign-in start after expiry |
| Email link token `cbp_ml_` | Site, on a sign-in request | Finish one sign-in for one email, in the browser that asked | 15 minutes, single use | Hash, in `login_links` | In the mail only; read from the URL fragment | Use, expiry, a newer link asked from the same browser |
| Session token `cbp_ses_` | Site, on sign-in by link or passkey | The site's API for one account | 14 days idle, 60 days absolute | Hash, in `sessions` | Cookie `__Host-cbp_session` | Sign out, "sign out everywhere", account deletion, expiry |
| Pairing device code `cbp_dc_` | Site, when the app starts pairing | Collect one device token for one pending pairing | 10 minutes, single use | Hash, in `pairings` | App memory only | Use, expiry, denial on the site |
| Pairing user code (short) | Same call | Lets a signed-in user approve that pending pairing | 10 minutes, single use | Hash, in `pairings` | Shown on the app's screen | Use, expiry |
| Device token `cbp_dev_` | Site, on the first poll after approval | Read one account's classes and changes; start live sessions for that account. No write to stored data | No fixed end; ends after 180 days without use | Hash, in `devices` | Operating system keychain | The user on the site, account deletion, idle expiry; the app can revoke its own |
| Source link code `cbp_lc_` | Site, when the user approves a link | Exchange once for a source token | 60 seconds, single use | Hash, in `source_link_codes` | In the redirect to the source | Use, expiry |
| Source token `cbp_src_` | Site, on the code exchange | Publish and remove classes for one account; read its own publication numbers. Reads no class content, devices or account data | No fixed end; ends after 365 days without use | Hash, in `source_links` | Encrypted in the source's own store | The user on the site, the source itself, account deletion, idle expiry |
| Host token `cbp_hst_` | Live process, when a device starts a live session | Be the host of that one session | The session | Hash, in memory | App memory only | Session end; device revoked; account deleted |
| Join code (short) | Live process, when a session starts | Names one live session; lets a phone ask to join as a rider | The session | Memory of the live process | On the room screen and in the QR code | Session end; the host can lock the session or make a new code |
| Control code (short) | Live process, when the host asks | Exchange once, with the session's join code, for a controller token | 2 minutes, single use | Memory, with its session | On the instructor's screen only | Use, expiry, 5 wrong tries for its session, a newer code |
| Controller token `cbp_ctl_` | Live process, for a control code or the instructor's session | Steer and follow one live session | The session | Hash, in memory | Phone, `sessionStorage` | The host drops the controller; for one got by sign-in, the end of that site session; session end |
| Rider token `cbp_rdr_` | Live process, on a join | Follow one live session and send that rider's own data to its host | The session | Hash, in memory | Phone, `sessionStorage` | The host removes the rider; 5 minutes without a connection; session end |

Passkeys are not tokens. The server stores only the public key (section 4).

### 4. Accounts and sign-in

**Account.** One row in `accounts`: a UUID, the email (trimmed and lower-cased, unique, at most
254 characters), a random 32-byte passkey user handle, and dates. The account id is the tenant
key everywhere. A later gym account that groups instructors adds a membership table and does not
change this key.

**Who can sign up.** Sign-up and sign-in are the same flow: the first sign-in for an email
creates the account. The mode `SIGNUP_MODE` is `allowlist`, `open` or `closed`, held by the
database (principle 7). It is `allowlist`: only emails in the table `signup_allowlist`, kept by
the operator, can create an account. This is the safest reversible default. Who is let in is
settled in the provider-terms ADR and by the owner. An address **can sign in** when it has an
account or may create one. No mail is ever sent to an address that cannot sign in.

**The browser token.** When a browser asks for a sign-in link or starts a passkey sign-in, the
site sets `__Host-cbp_login=<cbp_lgn_ token>`; `Secure`; `HttpOnly`; `SameSite=Lax`; `Path=/`;
`Max-Age=3600`. A valid one is reused. Its hash is stored with the link or the challenge. It
proves only "the same browser".

**Email link.**

1. The user enters an email. The answer is always the same page and status ("if this address
   can sign in, a link is on its way"). It is the same for an unknown address, an address that
   is not allowed, and an address over its limits (section 10). Only the per-address limit, which
   does not depend on the email, answers 429, and input that is not an email address at all
   answers `422` (step 2).
2. The request makes the same two calls for every address (amended 2026-11-12). First,
   `rate_limit_hit` for the requesting address alone, which answers the 429 of step 1 before
   the email is looked at. Then `auth_request_login`, in the same transaction: the counters
   are kept and a row is written to `login_links` with the hash of a new `cbp_ml_` token, the
   email and the browser token's hash. For an address that cannot sign in, or over its limits,
   the row is marked unusable and no mail is sent. The mail is queued and sent after the
   response. The work differs by one row only: for an address that has an account the function
   also writes the "link requested" event (section 11), whether or not a mail is sent.
   Otherwise the function does the same lookups and writes for every address, with one
   exception that section 10 requires: a request over its per-pair limits does not count
   toward the per-email total of 30 a day, so it makes one counter write fewer. That depends
   only on the requester's own earlier requests for that email, so it tells them nothing new.
   A request over any of its limits, the per-email total included, also cancels no older link
   (step 3); over the per-email total that tells the requester at most that the day's total
   for that email is used up, whether or not the address can sign in.
   Input that is not an email address is refused with `422` after the first call and makes
   no second call. A body that is not valid JSON of the expected shape is refused by the
   framework with `422` before the first call and counts nothing.
3. A newer link cancels older ones **only when asked from the same browser** (the same browser
   token), and only when the request is within its limits (section 10). A request over its
   limits cancels nothing. Whether the address can sign in plays no part (amended 2026-11-12).
   Links asked from other browsers stay valid: each works only in its own browser, so
   nothing is lost, and a stranger who knows the email cannot cancel the user's link.
4. The mail holds `https://<site>/sign-in#<token>`. The token is in the fragment.
5. The page reads the fragment, removes it from the address bar (`history.replaceState`) and
   shows a "Sign in" button. Pressing it sends the token in the body of a POST. A mail scanner
   that opens the link uses nothing up.
6. The server accepts the token once, within 15 minutes, and only with the matching browser
   token. Every refused completion gets the same answer: an expired, used, unknown or
   wrong-browser link alike. The page says to ask for a new link from this browser (amended
   2026-11-12). So a forwarded or stolen mail does not sign anyone in. This is the setting
   `LOGIN_LINK_SAME_BROWSER`, on by default.
7. On success the account is created if needed, a session is issued and the link row is deleted.

**Passkeys (WebAuthn).**

- The relying-party id is the site's host name and the origin must match exactly. Both come from
  one setting, because the domain is the owner's (decision 10).
- Registration needs a signed-in session with a recent sign-in. Discoverable credentials, user
  verification required, attestation `none`, algorithms ES256, EdDSA and RS256.
- Stored per passkey: credential id, public key, signature counter, transports, a name, dates.
  At most 10 per account.
- A challenge is 32 random bytes, single use, valid 5 minutes, stored server-side. A sign-in
  challenge is bound to the browser token. A registration challenge is bound to the session.
- Sign-in sends no list of credentials and takes no email: the browser offers the passkeys it
  has. So the sign-in request tells nothing about any address.
- Signature counter: when the stored or the received counter is non-zero, the received one must
  be greater than the stored one. Otherwise the sign-in is refused and an audit event is written.
- The backend checks the WebAuthn signature. A sign-in whose signature fails never reaches
  `auth_complete_passkey`: it is counted per address (section 10) and writes no event, because
  no account is set then.
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
  minutes, when the session is checked at the start of a request, so a signed-in request that
  is refused later (for example for want of a recent sign-in) still counts as use. At most 20
  sessions per account; the oldest is dropped.
- Revocation deletes the row, so it takes effect on the next request. The site lists sessions
  (browser family, last used) and can end one or all. Signing out with a session that has
  already ended or expired is done already: it answers `204` and clears the cookie.
- Cross-site requests. Every state change is a POST, PUT, PATCH or DELETE. For those the server
  requires an `Origin` header equal to the site's origin, and refuses the request when
  `Sec-Fetch-Site` is present and is not `same-origin`. No cross-origin resource sharing is
  enabled.
- **Where the session cookie is accepted.** By the site's API (`/api/site/`), and by exactly one
  live route, `POST /api/live/controller` (section 8), which applies the same
  `Origin` and `Sec-Fetch-Site` checks. Nowhere else: the player API, the source API, every other
  live route and the WebSocket ignore cookies and take a token in `Authorization: Bearer`, in the
  request body, or in the first WebSocket message. A guard test lists the routes that read the
  cookie and compares them with this list.
- Responses that carry a token have `Cache-Control: no-store`.
- Every page of the site is sent with `Content-Security-Policy: default-src 'self';
  frame-ancestors 'none'; base-uri 'none'; form-action 'self'` and `Referrer-Policy: no-referrer`.
  PL2 may add to the policy what the site's own scripts need, never a third-party origin. No
  form of the site posts to, or is redirected to, another origin (section 7, step 4).

### 6. Pairing a device

The shape is the OAuth device flow (RFC 8628), with our own endpoints.

1. The app calls `POST /api/pairing/start` with its platform and version. It gets a device code,
   a user code, the address of the pairing page, `expires_in: 600` and `interval: 5`.
2. The app shows the user code and opens `https://<site>/pair` in the browser. The code is not
   in the address. The signed-in user types it.
3. This step is two calls, both POSTs with the code in the body.
   - *Look up.* The site calls `auth_find_pairing` with the code's hash. It changes nothing
     about the pairing. A code that matches no pending pairing counts as a wrong code. The page
     then shows the platform and version the request came from and asks the user to confirm
     only if the code is on their own player's screen right now.
   - *Decide.* The user names the device (1 to 40 characters) and confirms, or denies. The site
     calls `auth_decide_pairing` with the same code's hash.
4. The app polls `POST /api/pairing/token` with the device code in the body every 5 seconds.
   Answers: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, or success.
5. On the first poll after approval the server, in one transaction, creates the device token,
   stores its hash in `devices`, marks the pairing used and returns the token with the account's
   email. The clear token is never stored. A second poll gets `expired_token`.
6. The app shows the email of the account it joined and saves the token in the keychain.

If the answer of step 5 is lost, a device row exists whose token nobody holds. It shows on the
site as "never used" and can be revoked there. A device never used within 24 hours of pairing is
deleted. The app starts pairing again.

Limits: a pairing lives 10 minutes. A user gets 5 wrong codes in 15 minutes, then the form is
closed for 15 minutes. Both calls of step 3 count wrong codes, inside the database. An address
may start 10 pairings an hour. At most 10 active devices per account, counting approvals not yet
collected; an approval above that is refused: `auth_decide_pairing` returns nothing (`NULL`), the
site answers `409 too_many_devices` and the refusal is the audit event `pairing.refused`. The
`409` comes only for a code that matches a pending pairing; a wrong code at the cap is still a
wrong code (`404`, counted).

**The app's routes without a credential** (`POST /api/pairing/start`, `POST /api/pairing/token`)
are for the desktop app, not for a browser. They refuse a request whose `Sec-Fetch-Site` header
is present and is not `none` (`403 cross_site_request`; browsers send it, the app's main process
does not), and a body that is not `Content-Type: application/json` (`415`). A body that claims JSON and does not parse is
refused by the framework (`422`) before that check; nothing runs either way. A guard test
compares the routes with this check with the routes that take no credential.

The user code can only attach the waiting device to the account of whoever confirms it. Only the
holder of the device code, which never leaves the app, collects the token. So a guessed user code
gives the guesser nothing.

**The reverse direction** (a code shown on the site and typed into the app) is not built. One
direction is enough, and the plan describes this one.

**The device token.**

- Sent as `Authorization: Bearer`. The app refuses a server address that is not HTTPS, except
  loopback in development.
- Scope: the player API (classes, removals, cursors) for its account, and starting live sessions
  for that account. "Read-only" means it changes no stored data: live sessions are not stored.
- On the device it is kept in the operating system's secret store (Keychain, DPAPI, Secret
  Service), through Electron's `safeStorage`, in a file only that user can read. If none is
  available the app does not pair: there is no plain-text fallback, and on Linux `safeStorage`'s
  `basic_text` and `unknown` count as none (as built in #84; stricter than keeping the token in
  memory for the run).
- A shared studio computer holds one device token per paired account, each its own keychain
  entry and its own cache. As built in #84 the app holds one pairing at a time; more than one
  account per computer is left for later. Switching account is local and needs no credential (see the threat
  table and Consequences).
- The site lists devices: name, platform, paired date, last used. Revoking one sets
  `revoked_at`. The row is kept 90 days so the server can answer `token_revoked`, then deleted.
- Answers to a device token that does not work, all 401:

| Answer | When | The app |
|---|---|---|
| `token_revoked` | The user revoked the device | Deletes that account's cached classes and the token, after any class being played has ended |
| `token_unknown` | No such token: the account was deleted, or the row is gone | The same |
| `token_expired` | 180 days without use | Keeps the cache, shows "pair again", and syncs after a new pairing to the same account |

  The app never deletes a cache on a network error or a 5xx answer.
- A paired device sends the user a mail ("a new device was paired"), to the address that
  `auth_collect_pairing` returns. A new passkey and an approved source link send one too, from
  the signed-in request that added the passkey or approved the link.
- The token is not rotated (see Alternatives).

### 7. The source API

**Linking.** The shape is the OAuth authorization-code flow with PKCE and no client secret.

1. Known sources are a setting: an id (`classbeat`), a display name and the exact redirect
   addresses allowed.
2. The source sends the user's browser to `https://<site>/link/source` with `source`,
   `redirect_uri`, `state` and `code_challenge` (S256). An unknown source or redirect address is
   refused without redirecting.
3. The signed-in user sees which product asks and what it may do, and approves. The page sends
   the approval as a script request (a POST to the site's API), not as a form submission.
4. The answer holds the address to go back to: the redirect address with a `cbp_lc_` code and
   the `state`. The page's script then navigates there. A form submission that ends in a
   redirect to the source would be stopped by `form-action 'self'` (section 5), and the policy
   is not widened for it. The code lives 60 seconds and works once. It is stored with the
   account, the source id, the redirect address and the challenge, and is good only for those.
5. The source's server calls `POST /api/source/token` with the code, the `redirect_uri` and the
   `code_verifier` in the body. All four bindings are checked. It gets the source token once.

At most 5 links per account; a link idle for 365 days is neither listed nor counted, and its row
stays until it is revoked. The site lists them (source, linked date, last used) and can revoke
each. The source can end its own link with `DELETE /api/source/link`. Revoking a link keeps the
classes: they belong to the account.

**Publications.** `POST /api/source/publications` with the source token and the envelope of
ADR 0003, section 6: `source_class_id`, `publication_number`, `removed`, `content_hash`,
`document`.

- A class is keyed by account, source id and `source_class_id`, a unique key. The source id
  comes from the token, never from the body. A new link to the same source continues the same
  numbers.
- `publication_number` is an integer from 1 to 2^63 − 1.
- The server computes the content hash of the document itself, by ADR 0003's rule, and refuses a
  document whose hash differs from `content_hash` (422).
- **One row per class key, in `classes`, for as long as the account lives.** It holds the key,
  the highest number seen, the kind of that publication (class or removal), its hash, its time
  and its place in the account's sync order. It holds the document only while the class exists.
  The "highest number seen" below is always this row's number.
- The decision is made in one transaction. It first runs `INSERT … ON CONFLICT (account_id,
  source_id, source_class_id) DO NOTHING` with number 0, then `SELECT … FOR UPDATE` on that row.
  So a first publication has a row to lock too, and two sends of the same class never cross.
- The row with number 0 is a placeholder: no document. If the publication is refused, the
  request is rolled back to a savepoint taken after the token check, and the placeholder goes
  with it, so none is ever committed. The token's counters and "last used" stay; the refusal's
  event is written in a second transaction that enters the account again through
  `auth_enter_source`, and is not written if the link has ended in between. The
  player API takes only rows with a number above 0. The class list and the count of 2,000 take
  only rows that hold a document.
- **The sync cursor** is one row per account in the tenant table `account_sync`, made at the
  account's first publication. An applied publication locks it, adds one and writes the new
  value on the class's row. So one account's changes get their numbers in the order they
  commit, and the backend never writes to `accounts`.
- **A refused publication** (stale or conflict) rolls its transaction back. Its audit event is
  then written in a second transaction of the same request, which enters the account again
  with `auth_enter_source`.

| Incoming number against the highest seen | Result |
|---|---|
| Higher | Applied. The class or the removal is stored and the account's sync cursor moves. `200 applied` |
| Equal, same kind (class or removal) and same hash | A repeat. Nothing changes. `200 repeat` |
| Equal, different kind or hash | `409 publication_conflict` |
| Lower | `409 stale_publication`, with the highest number seen |

- A removal deletes the document at once and leaves a marker. The marker is the class's own
  row without its document: account, source id, class id, the number and the time. No title, no
  content. The marker stays as long as the account, so a late send of older content can never
  bring the class back. The backend's role has no `DELETE` on `classes` (section 9). A later,
  higher-numbered publication with a document stores the class again: that is the user sending
  it again.
- Deleting a class on the site writes the same marker at the highest number seen.
- A source that lost its counter reads the highest number from the 409 answer or from
  `GET /api/source/classes/{id}` (numbers only) and continues above it.
- Limits: a document is at most 1 MiB, an account holds at most 2,000 classes, a token may send
  60 publications a minute.

### 8. Live sessions (PL8)

All `/api/live/` routes, HTTP and WebSocket, are served by the one live process (plan section
5).

**What is in memory and what is in the database.** Live sessions, their codes, the host,
controller and rider tokens, nicknames and readings exist only in the live process's memory.
Nothing about riders is written to the database or to logs. The live process does read the
database, as the role `player_app` and only through the functions of section 9, for three
things: to check a device token when a session starts and while it runs (`auth_enter_device`,
`auth_device_active`), to check a site session on the one cookie route and while its controller
is connected (`auth_enter_session`, `auth_session_active`), and to write the account's audit
events.

**Roles.**

| Role | Who | Proves it with | May |
|---|---|---|---|
| Host | The app that started the session | The session's host token | Lock and end the session; publish the clock and class state; make codes; drop controllers and riders; receive riders' data |
| Controller | The instructor's phone (handlebar companion) | A controller token | Receive the clock, the cue and what is next; send start, pause, skip and nudge to the host |
| Rider | A rider's phone | A rider token | Receive the clock and class state; send their own nickname and readings to the host |

**Starting, and who the host is.**

- The app calls `POST /api/live/sessions` with its device token. The live process checks the
  token in the database, creates the session and records the device id, the account id and the
  hash of the device token with it.
- The answer holds the session id, the join code and a **host token**. The host token is given
  out once, only here, and kept in the app's memory.
- Only the host token makes a connection the host. A device token never attaches to a session.
  So another device of the account, or a stolen device token, cannot become the host of a
  running session or receive its riders' data. It can only start a session of its own, with its
  own join code and no riders.
- One host connection at a time. A new connection with the valid host token replaces the old
  one, which is closed with code 4409. That is the reconnect after a network drop.
- If the app loses the host token (it was restarted), the session cannot be taken up again. It
  ends by the rule below and the app starts a new one.
- **One live session per device.** When a device starts a session, the live process first ends
  any earlier session that device started. So an app that was restarted never fills the limit
  with sessions it can no longer reach.
- At most 3 live sessions per account. A session ends when the host ends it, when its device
  starts a new one, 15 minutes after the host's connection is lost, or after 12 hours.

**Revocation while a session runs.**

- The live process records, with each session, the hash of the device token that started it,
  and with each controller got by sign-in, the hash of the site session token that asked.
- **The re-check.** Every 30 seconds the live process calls `auth_device_active` for each
  session and `auth_session_active` for each such controller.
  - Device not active (revoked, expired, or the account is gone): the session ends. The host,
    controller and rider tokens are dropped and every connection is closed with code 4403.
  - Site session not active (signed out, "sign out everywhere", expired, account gone): that
    controller is dropped. The session goes on. A controller got by a control code is not tied
    to a sign-in; the host drops it.
- **The hint.** The site's transaction that revokes a device, ends sessions or deletes an
  account calls `pg_notify('live_revocations', <account id>)`. On a notification the live
  process runs the re-check at once for that account's sessions. A notification carries no
  authority: only the re-check's answer changes anything.
- The live process listens on a connection of its own, kept open for that purpose, direct to
  the database and never through a transaction pooler. When that connection is lost it
  reconnects and runs the full re-check at once.
- So every revocation, a missed notification included, takes effect within 30 seconds.
- **Audit.** "Live session started" and "ended", "control code cancelled" and "controller
  added" by a control code are written by the live process after `auth_enter_device` with the
  session's stored hash. "Controller added" by sign-in is written after `auth_enter_session`.
  Once the device is revoked `auth_enter_device` no longer sets the account, so
  the live process writes nothing then. The site's own event, written in the revoking
  transaction ("device revoked", "all sessions ended"), is the record, and its detail says that
  live sessions end with it. A deleted account has no events left to write to.

**Joining as a rider.** The room screen shows the join code and a QR code of
`https://<site>/j#<code>`. The code is in the fragment and the address carries nothing else: no
account, class, instructor or tracking value (rule 14). The phone calls `POST /api/live/join`
with the code and a nickname in the body, and gets a rider token. A nickname is 1 to 24
characters with control characters removed, is always rendered as text, and is gone when the
session ends. A join that fails gets one answer, `cannot_join`, whether the code is unknown,
the session is locked or it is full, so it tells nothing about who is there. Join limits are
made for a whole class on one studio address (section 10): joins are counted per session, and
only joins with an unknown code are counted per address. The rider's FTP and maximum heart rate
stay on the phone (plan section 7).

- **Places.** At most 60 riders are connected to a session at a time. The cap counts open
  rider connections, not tokens given out.
- A rider token with no connection for 5 minutes is dropped, and so is one that never
  connected. The phone then joins again. So a rider who closed the tab and scans again takes
  no second place, and the host's list shows who is there now.
- What the app does with riders' data is PL8's to build inside rule 13, and the PL8 issue
  names it: the instructor's view only, never the room screen, no ranking or comparison of
  riders, nothing kept after the session.

**Becoming a controller.** Two ways, as the plan says. The join code alone never gives control.

- *By sign-in.* The instructor is signed in on the phone with the account that hosts the
  session. The phone has the join code, scanned or typed like a rider's, and calls
  `POST /api/live/controller` with a body of `session` (the join code, used here only to name
  the session). This is the one live route that takes the session cookie, with the checks of
  section 5. The live process checks the site session in the database and that its account is
  the live session's account.
  - The join code names the session and gives nothing: without the host account's sign-in the
    call fails.
  - Every failure gets one answer, `cannot_control`. An unknown code counts as a join with an
    unknown code for the caller's address (section 10).
  - So no route lists an account's live sessions, and the list of cookie routes stays at one.
- *By control code.* The host asks the live process for a control code for its session. The app
  shows it in the presenter window only, never on the room screen, as text and as a QR code of
  `https://<site>/control#<join code>.<control code>`. An app with one display has no presenter
  window and offers no control code: control is by sign-in only there.
- The phone calls `POST /api/live/control` with a body of `session` (the join code, used here
  only to name the session) and `code` (the control code). The live process finds the session by
  the join code and compares the control code with that session's current one only.
  - A right code gives a controller token and is used up.
  - A wrong code for a session that exists counts against that session, not against the
    caller's address. At 5 the session's control code is cancelled and the host is told. The
    host resets it by making a new code.
  - An unknown session and a wrong code get the same answer, `invalid_code`. An unknown session
    counts as a join with an unknown code for the caller's address (section 10).
  - There is no per-address limit on exchanges for a session that exists. The instructor's
    phone and the riders' phones share the studio's address, so such a limit would let a rider
    lock the instructor out.
  - A host may make 30 control codes an hour per session. That bounds guessing at 150 tries an
    hour per session.

Either way the phone gets a controller token. At most 2 controllers per session.

**WebSocket sign-in.** One endpoint, `wss://<site>/api/live/ws`.

- No token in the address and no cookie is used. The first message must be
  `{"type":"hello","token":"<token>"}` and must arrive within 5 seconds. Otherwise the server
  closes with code 4401. Only `cbp_hst_`, `cbp_ctl_` and `cbp_rdr_` tokens are accepted. The
  prefix gives the role and the token gives the session.
- For controller and rider tokens the handshake's `Origin` must be the site's origin.
- Before `hello`, a connection may send one message of at most 1 KiB. After it, a message is at
  most 16 KiB and a connection may send 10 messages a second. Breaking a limit closes the
  connection.
- One connection per token. A new connection with the same token replaces the old one.
- When a token is dropped or the session ends, the server closes its connections with code 4403.

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
- The server relays rider readings to the one host connection and keeps nothing.

### 9. Tenant isolation

**Roles in PostgreSQL.**

| Role | Used for | Rights |
|---|---|---|
| `player_owner` | Migrations and the operator's commands only | Owns the schema and the tables. A member of `player_auth`, so that migrations can create its functions |
| `player_app` | The running backend, including the live process | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, owns nothing. Grants below |
| `player_auth` | Owner of the `SECURITY DEFINER` functions | `NOLOGIN`, `BYPASSRLS`. Nobody but `player_owner` is a member. Grants below |

**Two kinds of table.** Both have row-level security enabled **and forced**.

- *Tenant tables* hold an account's data: `accounts`, `sessions`, `passkeys`,
  `passkey_registrations`, `devices`, `source_links`, `classes`, `account_sync`, `audit_events`
  and every later table of the kind. Each has `account_id uuid NOT NULL REFERENCES accounts(id)
  ON DELETE CASCADE` (`accounts` uses its `id`) and this policy:

```sql
CREATE POLICY tenant ON <table>
  USING      (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid))
  WITH CHECK (account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid));
```

  With no account set the expression is null and no row is visible or writable. The inner
  `SELECT` makes the setting be read once per query.

- *Closed tables* exist before any account is known or hold what the backend must not read
  freely: `login_links`, `login_challenges`, `pairings`, `source_link_codes`, `rate_limits`,
  `signup_allowlist`. `player_app` has **no grant** on them and they have no policy for it. They
  are reached only through the functions below. `pairings.account_id` is null until approval.
  This list is the written allowlist of tables without the tenant policy.
- `signup_allowlist` has one policy, for `player_owner` alone, allowing everything. The operator
  edits the list with a command of the backend (`allowlist add`, `remove`, `list`) that is run
  on the server and connects as `player_owner`, like a migration. No running role can write it.

**Grants.**

Both tables below are privileges exactly as the catalogue holds them: per table, and per
column where a column is named. The guard tests compare the catalogue with them. Which rows a
function touches (expired ones, the oldest session) is in the function's body and its own
tests, not in a grant. Neither role has `TRUNCATE`, `REFERENCES` or `TRIGGER` on any table.

`player_app`, on the tenant tables and under the policy, the least the backend's flows need.
It also has `EXECUTE` on the functions below. Nothing else.

| Tables | Rights of `player_app` | Used for |
|---|---|---|
| `accounts` | `SELECT`, `DELETE` | Showing the account, export; deleting the account. No `INSERT` and no `UPDATE`: accounts are made by `auth_complete_login`, and the email cannot be changed |
| `sessions` | `SELECT`, `DELETE` | Listing; sign out, ending one or all. Sessions are made only by the sign-in functions |
| `passkeys` | `SELECT`, `INSERT`, `DELETE` | Listing, adding and removing a passkey |
| `passkey_registrations` | `SELECT`, `INSERT`, `DELETE` | The registration challenge, used once |
| `devices` | `SELECT`, `UPDATE (revoked_at)` | Listing; revoking. Devices are made only by `auth_collect_pairing` |
| `source_links` | `SELECT`, `DELETE` | Listing; revoking, by the user or by the source. Links are made only by `auth_exchange_link_code` |
| `classes` | `SELECT`, `INSERT`, `UPDATE` | Publications, removals, deleting a class on the site. No `DELETE`: a marker is never deleted |
| `account_sync` | `SELECT`, `INSERT`, `UPDATE` | The sync cursor |
| `audit_events` | `SELECT`, `INSERT` | Reading and writing events. **No `UPDATE` and no `DELETE`**: events are append-only for the backend |

`player_auth`, the least its functions need:

| Tables | Rights of `player_auth` |
|---|---|
| `login_links`, `login_challenges`, `pairings`, `source_link_codes`, `rate_limits` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `signup_allowlist` | `SELECT` |
| `accounts` | `SELECT`, `INSERT` |
| `sessions`, `devices` | `SELECT`, `INSERT`, `UPDATE (last_used_at)`, `DELETE` |
| `source_links` | `SELECT`, `INSERT`, `UPDATE (last_used_at)` |
| `passkeys` | `SELECT`, `UPDATE (sign_count, last_used_at)` |
| `audit_events` | `INSERT`, `SELECT (occurred_at)`, `DELETE` |
| `classes`, `account_sync`, `passkey_registrations` | None |

`player_auth` deletes from `sessions` for the cap of 20 and for expiry, from `devices` for old
revoked and never-used rows, and from `audit_events` for retention. Those are the only ways an
event is removed, apart from the deletion of its whole account.
The retention purge's `DELETE … WHERE occurred_at < …` needs `SELECT` on that one column
(amended 2026-11-12, from the review of PR #32).

The migration ledger `player_meta.schema_migrations` is the one table that is neither a tenant
table nor a closed table. It has row-level security enabled and forced, one policy for
`player_owner`, and no grant to `player_app` or `player_auth` (amended 2026-11-12).

**Setting the account.** An `auth_enter_*` function looks a credential up by its hash, checks
that it is valid, and then runs `set_config('app.account_id', <account id>, true)`. The value is
local to the transaction, so a pooled connection never carries one request's account into the
next. It is never set at session level, and the backend's code never sets it itself. An account
id is a random UUID. No endpoint and no function shows it to another account.

**The functions.** All are `SECURITY DEFINER`, owned by `player_auth`, with
`SET search_path = pg_catalog, <schema>, pg_temp` (`pg_temp` named last, so a temporary object
can never stand in for a real one). Anything outside those schemas is called schema-qualified.
`EXECUTE` is revoked from `PUBLIC` and granted to `player_app`. This is the complete list.
Adding one is a security-critical change.

| Function | Does | Returns |
|---|---|---|
| `auth_enter_session(hash)` | Finds a live session row by its token hash, updates last-used, sets the account | The session's id and last sign-in time, or nothing |
| `auth_enter_device(hash)` | The same for a device token | The device id and a state: `ok`, `revoked`, `expired`, `unknown` |
| `auth_enter_source(hash)` | The same for a source token | The link id and the source id, or nothing |
| `auth_device_active(hash)` | Checks a device token without setting the account (live process) | True or false |
| `auth_session_active(hash)` | Checks a session token without setting the account (live process) | True or false |
| `auth_request_login(email, link_hash, browser_hash, address_hash)` | Counts the limits, writes the link row | True when a mail is to be sent |
| `auth_complete_login(link_hash, browser_hash, session_hash)` | Checks and uses up the link, creates the account if needed and allowed, creates the session | True or false |
| `auth_new_login_challenge(challenge_hash, browser_hash)` | Stores a passkey sign-in challenge | Nothing |
| `auth_passkey_for_login(credential_id)` | Finds a passkey by its credential id | The public key and the counter. No account id |
| `auth_complete_passkey(credential_id, challenge_hash, browser_hash, counter, session_hash)` | Uses up the challenge, applies the counter rule, creates the session | True or false |
| `auth_start_pairing(device_code_hash, user_code_hash, platform, version)` | Writes a pending pairing | Nothing |
| `auth_find_pairing(user_code_hash)` | For the account already set only: looks up a pending pairing that has not expired. Changes nothing about it. A code that matches none counts as a wrong code for the account; while the form is closed it finds nothing | The pairing's platform and version, or nothing |
| `auth_decide_pairing(user_code_hash, approve, name)` | For the account already set only: approves or denies that pending pairing. Counts a wrong code the same way. Refuses an approval above 10 active devices (approved and not yet collected count) | True when decided, false for a wrong code, nothing (`NULL`) when refused at the cap |
| `auth_collect_pairing(device_code_hash, device_token_hash)` | Poll: if approved, creates the device row and uses up the pairing | The state, and on success the account's email |
| `auth_new_link_code(code_hash, source, redirect, challenge)` | For the account already set only: stores a source link code. It writes no event (it takes no client); the exchange writes `source.linked` or `source.link_refused` | Nothing |
| `auth_exchange_link_code(code_hash, source, redirect, verifier, token_hash)` | Checks the bindings and the PKCE verifier, uses up the code, creates the source link. Refuses above 5 links per account | True or false |
| `rate_limit_hit(key_hash, window, limit)` | Counts one event in a fixed window | True when over the limit |
| `auth_purge_expired()` | Deletes expired links, challenges, pairings, codes, counters, sessions, old revoked devices, never-used devices and audit events past retention | Nothing |

"For the account already set" means the function reads `app.account_id` and does nothing when
it is empty. Every function that writes an audit event, a session or a device takes one more
argument, left out of the table: `client`, the shortened address and the browser or app family
as the backend saw them (section 11).

The database checks what it can itself: hashes, expiry, single use, the browser binding, the
PKCE verifier, the counter rule, the limits.

**Audit inside the functions.** Every `auth_*` function that makes, uses up or refuses a
credential for an existing account writes that account's audit event itself, in the same
transaction: link requested, signed in, sign-in refused, pairing decided, device created,
source link created. A caller cannot do one of these without the event. The `auth_enter_*`
functions run on every request: they update "last used" and write no event. The `*_active`
functions and `auth_find_pairing` write no event either.

**Events are append-only for the backend.** `player_app` can read and add events and can
neither change nor delete one. So an event written by a function stays for its 180 days,
whatever the caller does next. Two limits, stated so that nobody builds on more:

- `player_app` can delete an account it has entered, and its events go with it. That cannot be
  done quietly: the user can no longer sign in to the account, and every paired device wipes
  its cache.
- `player_app` can add events. Inside an account, an event may be false or missing for what
  the backend does with its own grants (adding a passkey, revoking a device, ending a
  session). Only the events written inside the functions are sure to be there.

**What this stops and what it does not.** Stated exactly, so that nobody builds on more:

- It stops *accidents*: a query that forgot its account filter, a new table without a policy, a
  job that ran with no account. Those return nothing, and the guard tests catch them.
- It keeps what is in the closed tables away from the backend's own queries: pending links,
  challenges, pairing rows, link codes, counters and the allowlist.
- It does **not** contain code that runs as `player_app`, that is a compromised backend or
  injected SQL. Such code can act for any account whose email, passkey credential id or account
  id it knows:
  - it can call `auth_request_login` and `auth_complete_login` with a link token, a browser
    token and a session token of its own making, for any address that can sign in. It then
    holds a session for that account without the mail being read. The database cannot tell this
    from a real sign-in, because the backend is what makes the link token and sends the mail;
  - it can do the same with `auth_complete_passkey` for a credential id it knows, because the
    WebAuthn signature is checked by the backend, not by the database;
  - it can run `set_config('app.account_id', …)` itself with an account id it knows;
  - inside an account it reads that account's rows, token hashes included, and does what the
    grants above allow: change classes, add a passkey, revoke devices, end sessions and links,
    add audit events, delete the account;
  - it can test one address at a time for whether it can sign in, because
    `auth_request_login` returns whether a mail is to be sent. It cannot list addresses.
- It cannot create an account outside the sign-in function and its allowlist, change an
  account's email, make a session, device or source link except through the functions, or
  change or delete an audit event.
- What stands against that:
  1. **No SQL is ever built from strings.** Every statement is a constant with bound
     parameters. Two layers hold this (amended 2026-11-12):
     - *At run time: the executor and `Query`.*
       - **The executor owns the driver.** The executor, one package, is the only code that
         holds a driver object. "The driver" is a closed list: `psycopg`, `psycopg_pool`, and
         any other database client library. The executor creates the pool and every
         connection, including the live process's listening connection, and no driver object
         leaves it: no connection, cursor, pool, notification or driver exception. It turns
         driver errors and notifications into its own types first. Data access, the migration
         runner and the operator's commands get a handle from the executor. A handle takes
         only a registered `Query` and bound parameters, and
         returns rows; it has no method that takes text. Only the listening connection takes no
         statement: the executor issues its `LISTEN` from a registered `Query` of its own.
       - **`Query` and its registry.** A `Query` is made only from a string literal in a query
         module, or from a `.sql` file committed in the repository; migrations are such files.
         The registry opens when the executor is imported. The query modules and the
         migration files are then loaded in one fixed list, and the registry is frozen. Making
         a `Query` after the freeze raises. The executor runs nothing before the freeze.
         `Query` has no `+`, `%`, `format`, `str()` or `repr()` that returns the statement, and
         no public attribute that holds its text.
       - **What is run.** The executor looks up the object it is given in its registry by
         identity, and runs the text the registry holds for it, never a field of the object.
         Anything else raises: a plain `str`, `sql.SQL`, `Composed`, bytes, a copy of `Query`,
         or an unregistered `Query`. `Query` is final: subclassing it raises. So SQL built
         from strings, and a query name rebound to a new value, fail when they are run. An
         object changed in place still runs its registered text. A test drives each of these
         through the public interface.
       - **What it holds against.** Ordinary code that uses the public interface of `Query`, the
         executor and its handles. It is not a sandbox. Code in the same process can patch the
         executor or reach private attributes, `gc`, `object.__setattr__`, introspection
         (`__globals__`, `__dict__`, `vars()`, frames) or a dynamic import. That is code
         written to evade the layers, the row "A compromised backend process" in the threat
         table, and review answers it.
     - *In the source.* A guard test reads the backend's source (the tests are not part of
       it; the guard tests read the catalogue with a driver of their own). It fails on:
       - any import of a driver library outside the executor;
       - any use of a driver object or a handle's private attributes outside the executor;
       - any handle call outside the data-access modules, the migration runner and the
         operator's commands;
       - a query constant used other than as the direct statement argument of a handle call;
       - a `Query` made other than from a string literal in a query module or from a `.sql`
         file in the fixed list;
       - SQL text made by an f-string, `format`, `%` or `+`.
       The linter's rule for string-built SQL is an error in CI as well.
     - *Scope.* The two layers answer injected SQL that comes from a mistake in ordinary code:
       the row "Injected SQL running as the backend's role". Code written to evade them is the
       row "A compromised backend process". The source guard is not expected to catch evasive
       code, such as re-exports, aliases of `sys` or `builtins`, or split strings.
       - **Blocking:**
         - a way for ordinary code, using only the public interface, to run text that is not a
           registered `Query`;
         - a driver object that ordinary code gets through the public interface of the
           executor or its handles: a return value, a public attribute or a raised exception;
         - an `import` or `from … import` statement of a driver library outside the executor.
       - **Non-blocking:** a bypass of the source guard by evasive code, or a bypass of the
         run-time layer that needs private attributes, patching, `gc`, introspection or a
         dynamic import.
  2. Row-level security as the backstop against accidental cross-account reads.
  3. The closed tables.
  4. The audit events written inside the `auth_*` functions, which the backend's role cannot
     change or delete: an account entered through the sign-in functions keeps a "signed in"
     event the user did not make, unless the whole account is deleted. An account entered
     with `set_config` and a known account id has no such event.
  5. The rate limits counted inside the functions. They slow a caller that keeps to one address
     hash; a caller that makes up address hashes is held only by the per-email limits.

**In FastAPI.** One dependency per credential type calls its `auth_enter_*` function as the
first statement of the request's transaction and yields an `AccountContext`. Data access takes
that context and a handle from the executor; nothing hands out a database connection.
Queries still filter by `account_id` in the code; the policy is the backstop.

**Guard tests** (never weakened; all read the catalogue or the source, so anything new fails
until listed):

- Every table has row-level security enabled and forced. Every table has the tenant policy
  unless it is on the closed list. `player_app` has no grant on any closed table, and no closed
  table has a policy except the one on `signup_allowlist` for `player_owner`.
- `player_meta.schema_migrations` is the only table outside the tenant and closed lists, named
  exactly: row-level security forced, one `player_owner` policy, no grant to `player_app` or
  `player_auth`. Any other table outside both lists fails.
- The set of `SECURITY DEFINER` functions equals the list above. Each is owned by `player_auth`,
  has the `search_path` above and is not executable by `PUBLIC`.
- The set of roles with `BYPASSRLS` equals `player_auth` plus the database's bootstrap
  superuser. `player_auth` cannot log in and its only member is `player_owner`. Its table and
  column grants equal its table above.
- `player_app`'s table and column grants equal its table above, and it has no grant on
  anything else. Named on their own, so that a later uniform grant fails: on `audit_events`
  it has exactly `SELECT` and `INSERT`; on `accounts` exactly `SELECT` and `DELETE`; on
  `classes` no `DELETE`. As `player_app` inside an account, an `UPDATE` and a `DELETE` on
  `audit_events` are refused.
- `player_app` is not a superuser, cannot bypass row-level security and owns nothing.
- As `player_app` with no account set, no tenant row is visible or writable. An account set in
  one transaction is gone in the next one on the same connection.
- No string-built SQL (item 1 above).
- With two accounts, every endpoint is called as one and can neither read nor change the
  other's rows.

### 10. Rate limits

Counters are fixed windows in the closed table `rate_limits`, reached through `rate_limit_hit`,
so several API processes share them. Keys are hashes (an email or an address is never stored in
a counter). Counters are kept for every email, known or not. The client address is taken from
the proxy header only when the request comes from a configured trusted proxy. A refused request
gets 429 with `Retry-After`, except where the table says otherwise. Live limits are counted in
the live process's memory. A request a route refuses keeps what its credential check wrote (the
counters, "last used"); any other error undoes the whole request.

So that the framework's own refusals count too, every route that holds a credential's
transaction (site sessions, device tokens, source tokens) takes its path and query values, and
the site its bodies, as raw text. It parses them with pure functions (`param_policy.py`,
`sync_policy.py`) and answers `422 invalid_request` itself. Site bodies are read before the
session's transaction opens. A publication's body is read by its own capped reader before the
source token is checked; its content is checked by `publication_policy.py`, which answers `422`
with its own codes (`invalid_publication`, `content_hash_mismatch`,
`unsupported_format_version`). An oversized publication gets `413 document_too_large` before
the token is checked, so today it is not counted; counting it is open work (#103). A guard test (`tests/guards/test_guard_raw_parameters.py`) fails on a typed parameter,
a length limit, an alias or a body model on any such route. Routes without a credential
(pairing start and poll, sign-in, the code exchange) look nothing up before their body is
valid, so the framework's `422` there counts nothing and reaches nothing (#96, #98).

| What | Limit | Over the limit |
|---|---|---|
| Sign-in link requests, per email and requesting address together | 3 per 15 minutes, 10 per day | The usual answer; no mail |
| Sign-in link requests, per email from all addresses | 30 per day | The usual answer; no mail |
| Sign-in link requests, per address whatever the email | 10 per hour | 429 |
| Failed passkey sign-ins | 10 per address per 10 minutes | 429 |
| Pairing starts | 10 per address per hour | 429 |
| Pairing polls | One per 5 seconds per device code | `slow_down` |
| Wrong pairing codes, at the look-up and at the decision together | 5 per account per 15 minutes | The form is closed for 15 minutes |
| Source code exchanges | 10 per address per minute | 429 |
| Source API requests (publications, number reads, ending the link) | 60 per source token per minute | 429 |
| Player API requests | 60 per device token per minute | 429 |
| The same unknown or revoked bearer token from one address | 20 per 5 minutes | That token from that address is refused for 5 minutes without a lookup |
| Different unknown bearer tokens from one address | 200 per 5 minutes | Requests with a token that is not valid are refused for 5 minutes; valid tokens from that address keep working. The address is counted first, so an address over its limit writes no per-token counter |
| Live joins, per session (per join code) | 120 per minute; 60 riders connected at a time | `cannot_join` |
| Live joins, control exchanges and controller requests with an unknown code | 60 per address per minute | Every join from that address is refused until the minute ends |
| Wrong control codes | 5 per session and code | The code is cancelled; the host is told and may make a new one |
| Control codes made | 30 per session per hour | 429 to the host |
| WebSocket connections | 300 per address per minute; 100 waiting for `hello` per address; one per token; 63 per session (60 riders, 2 controllers, the host) | Refused |
| Account exports | 3 per account per day | 429 |

The live limits are sized for a class of 40 to 60 riders who join in the same minute from one
studio address: nothing that a rider with the right code does is counted per address.

The per-email limits are counted per requesting address first, so one stranger cannot use up a
user's links. The total of 30 a day per email is a brake on mail sent to one mailbox. What is
left of that risk is in the threat table.

### 11. Audit events

One table, `audit_events`, owned by the account like any other: time, event name, the kind and id
of the credential that acted, the client address shortened to its network (/24 or /48), the
browser or app family, and a small detail object.

Events: sign-in link requested; signed in (link or passkey); sign-in refused; signed out (with
`current: false` when the user ends another of their sessions); all sessions ended; passkey
added or removed; passkey refused by the counter rule; pairing approved, denied or refused at
the device cap (`pairing.refused`); device created; device revoked; source linked or revoked;
publication applied, refused as stale or as a conflict; class deleted on the site; live session
started or ended; controller added; control code cancelled after wrong tries; export made.

Not events, because no account is set when they happen: a passkey sign-in whose signature
fails, and a request with a revoked device token. Both are counted in the limits (section 10).
A new source link code writes no event either (section 9).
Deleting the account writes no event either: its events go with it.

Events about sign-in, pairing and linking are written inside the `auth_*` functions (section
9), so the backend cannot do those things without them. The backend's role can add events and
read them. It cannot change or delete one. An event is written only for an account that
exists. A sign-in request or a refused sign-in for an unknown address writes no event, only
its counters.

An event never holds a token, a code, a hash, a class title, a nickname or a rider's reading.
Events are kept 180 days, are part of the export and go with the account. The site shows an
account its own events, beside its sessions and devices.

Logs follow the same rule: the `Authorization` and `Cookie` headers and request bodies of
token endpoints are never logged. Token hashes reach the database as function arguments, so
the database's log is covered too:

- Hashes are always bound parameters, never part of a statement's text.
- The init script sets, for the role `player_app`: `log_statement = 'none'`,
  `log_min_duration_statement = -1`, `log_parameter_max_length = 0` and
  `log_parameter_max_length_on_error = 0`. So no statement of that role is logged for its text
  or its duration, and no parameter value is ever logged. A deploy check reads these settings
  back.

### 12. Export and deletion

- **Export** needs a recent sign-in. It is a JSON archive streamed straight to the browser: the
  account, the class documents, devices, source links, passkey names, sessions and audit events.
  No hash, token or key is in it. Nothing is stored on the server and there is no download link.
- **Deleting a class** removes its document at once and leaves the marker of section 7.
- **Deleting the account** needs a recent sign-in and a typed confirmation. One transaction
  deletes the account row and, by cascade, everything owned by it: classes, markers, the sync
  cursor, devices, source links, sessions, passkeys, pending pairings, link codes and audit
  events. The cascade runs as the tables' owner, so the backend's role needs no `DELETE` on
  those tables and row-level security does not stop it. Its live sessions are ended (section
  8). Every token of the account stops working at once.
- **The reading of the plan chosen here.** Plan section 5 says that after a deletion "only the
  marker that it was removed stays". This ADR reads that as the marker of a deleted *class*. A
  deleted *account* leaves no marker and no row at all. Its devices learn of it through
  `token_unknown` at their next contact and wipe that account's cache (section 6).
- Rate-limit counters hold only hashes and expire with their windows.
- Backups and how long they are kept belong to the deploy runbook (PL7).

### 13. Threats and answers

| Threat | Answer |
|---|---|
| **A stolen device token** | It is read-only on stored data and reaches one account's classes only. It cannot read the account, its devices or its sources, cannot publish and cannot reach the site's API. The user sees the device and its last use on the site and revokes it; that takes effect on the next request and ends its live sessions within 30 seconds. It ends after 180 days without use. On the device it sits in the operating system's secret store, never in a plain file |
| A stolen device token used to reach riders' data | It cannot attach to a running session: only the host token does, and that is given once to the device that started the session and never stored. The thief can only start a session of their own, which has no riders unless people scan the thief's own screen |
| A second host connection taking over a session | Needs the host token. A new host connection replaces the old one, so there is always exactly one receiver of rider data |
| **A guessed pairing code** | 2.6 × 10^10 values, 10 minutes, 5 wrong tries per account per 15 minutes, and a signed-in session is needed to try at all. A hit only attaches someone else's waiting device to the guesser's own account; the token goes to the holder of the device code. The app shows which account it joined |
| A pairing code pushed on a user by an attacker | The code is typed, never in a link. The page says to confirm only a code on the user's own screen and shows the asking platform and version before anything is decided (`auth_find_pairing`). A mail tells the user a device was paired. The token is read-only and revocable |
| **A guessed join code** | Same code space; 60 joins with an unknown code per address per minute. A hit makes the guesser a rider in a stranger's class: they receive the clock and class state, never anyone's data. The host sees them, can remove them, lock the session or make a new code. At most 60 riders |
| A guessed control code | The exchange names a session, so a guess is tried against one session's code only. 2 minutes, single use, cancelled after 5 wrong tries, at most 30 codes an hour per session: 150 tries an hour against 2.6 × 10^10 values. A controller can only start, pause, skip and nudge; the host can drop it |
| A rider on the studio's Wi-Fi cancelling control codes on purpose | They know the join code, so they can burn each control code with 5 wrong tries. The count is per session, never per address, so the instructor's phone on the same Wi-Fi is not locked out: the host makes a new code, and a right code is accepted whatever was tried before. Someone who keeps burning codes can stop control by code for that class. Control by sign-in does not use the code and always works |
| A rider on the studio's Wi-Fi blocking joins on purpose | 60 joins with unknown codes a minute from the studio's address stop further joins from that address for the rest of that minute. Riders already in are not affected, nor are phones on mobile data. It lasts only while the person keeps it up |
| **A replayed publication** | Needs the source token. The same number and hash is a repeat and changes nothing. The same number with other content is refused |
| **An out-of-order publication** | A lower number is refused as stale. The check and the write are one transaction under a row lock that exists from the first publication, so two sends cannot cross. Markers of removed classes keep their number, so old content cannot return |
| A stolen source token | It writes classes for one account and reads nothing but publication numbers. The user or the source revokes it. Publications are audited. It ends after 365 days without use |
| **One account reading another's rows** | Queries filter by account in the code. Row-level security, forced, with a role that cannot bypass it, refuses the rest. The account is set per transaction by a function that has checked a credential. Guard tests cover every table, every function and every endpoint. This answers mistakes in the backend's code. It does not answer a backend that is itself compromised: see the next two rows |
| **A rider reaching another rider's data** | The server has no route from rider to rider. Messages to riders are closed schemas with no rider-derived field. Riders get no roster or count, and a failed join does not say whether a session is full. A rider token is tied to one session and one rider. Rider data goes to the one host connection only. Nothing about riders is stored. A rule guard test holds this |
| A stolen session cookie | `HttpOnly`, `Secure`, `__Host-`. Sensitive actions need a recent sign-in. Sessions are listed and can be ended. 14 days idle, 60 days in total |
| A forwarded, intercepted or pre-opened sign-in link | Single use, 15 minutes, bound to the browser that asked, token in the fragment and removed from the address bar, used only by a POST |
| A stranger who knows an email blocking that account's link sign-in | A new link cancels older ones only from the same browser, so the stranger cancels nothing. The limits count per email and requesting address together, so the stranger uses up only their own. What is left: someone with several addresses can reach the total of 30 a day for one email, which stops new links to that mailbox until the next day and sends it up to 30 mails. Passkey sign-in and sessions already open are not affected |
| Finding out who has an account | A link request always gives the same answer, makes the same two database calls and sends mail after the response. The second call writes one row more for an address with an account (its audit event); that small difference in time is not hidden. A request over its per-pair limits writes one counter fewer, which tells the requester only about their own earlier requests. Over the per-email limits the answer is still the same, and a request over any limit cancels no older link; over the per-email total that tells at most that the day's total is used up. The only 429 depends on the requester's address alone. Passkey sign-in takes no email and lists no credentials. Unknown addresses write no audit event |
| Cross-site requests and cross-site WebSocket use | `SameSite=Lax`, the `Origin` check, no cross-origin sharing. The cookie is read by a fixed, tested list of routes. The WebSocket takes no cookie and checks `Origin` for browser roles |
| A token in a log, a link or a public repository | Long tokens are never in a path or query, and codes in links are in the fragment. The one exception, the source link code, lives 60 seconds and needs the PKCE verifier. Headers and token bodies are not logged. The prefix makes a leak findable; CI scans for it |
| A copy of the database | It holds hashes of 256-bit tokens, which cannot be reversed, and public keys. Live codes and tokens are not in it. It does hold all content, so a copy is a full breach of stored data; the hashes only stop it from becoming a way in |
| Injected SQL running as the backend's role | The defence is that it cannot happen: no SQL is built from strings, every statement is a constant with bound parameters, and a guard test and the linter fail the build otherwise. If it happened all the same, the roles would **not** contain it. The injected SQL could act for any account whose email, passkey credential id or account id it knows, by driving the sign-in functions or setting the account itself (section 9). It could not read the closed tables, bypass row-level security for accounts it knows nothing of, create an account, or change the schema. A sign-in it made through the sign-in functions would leave a "signed in" event in that account, and it has no right to change or delete an event. The event goes only if the whole account is deleted, which the user notices. An account entered with a known account id and `set_config` gets no event |
| A compromised backend process | The same bound, and more: it sees every request, token and mail that passes through it. Nothing in the database stops it from acting for the accounts it can name. What limits it: token hashes cannot be turned back into tokens, the closed tables are not readable in bulk, emails of other accounts are not listed anywhere it can read (it can test one address at a time through `auth_request_login`), and the sign-ins, pairings and links it makes through the `auth_*` functions leave events it cannot change or delete. What it does inside an account with its own grants is audited only if it writes the event itself, and it can delete an account it has entered, events included |
| An instructor opening another instructor's classes on a shared studio computer | Not prevented in this design. Each paired account's token and cache are separate, but switching account in the app needs no credential, so anyone at that computer can open the classes of every instructor paired on it. The tokens there are read-only. Removing an account from the app or revoking the device on the site ends it. A local lock is a later, owner-decided feature |
| Hostile text in a nickname or a device name | Length limits, control characters removed, always rendered as text. The site's content security policy allows no foreign script |
| The site shown inside another site's frame | `frame-ancestors 'none'` |
| A flood of requests or connections | The limits of section 10 and the message limits of section 8. A studio behind one address is not locked out by one bad token |

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
- **A newer sign-in link cancels every older one for that email.** Simple, but it lets anyone
  who knows the email cancel the user's link.
- **The device token as the host's credential on the WebSocket.** It names an account, not a
  session, and any device of the account would do. A host token per session binds the host to
  the device that started it.
- **A shorter join code (6 letters).** Easier to read from the back of a room. Most riders scan
  the QR code, so one code format for everything was preferred.
- **The join code in the path (`/j/<code>`).** It would reach server and proxy logs. The
  fragment costs nothing.
- **WebSocket sign-in by cookie, by a token in the address, or by a one-time ticket.** A cookie
  opens cross-site use. An address ends up in logs. A ticket works but adds a call and a store.
  The first-message token needs neither.
- **Tenant isolation in the code only.** One forgotten filter would leak. The plan asks for the
  database as well.
- **A signed account context** (the account id with a MAC under a secret only `player_auth`
  reads, checked in every policy). Tried in an earlier draft and dropped. It stops only a
  switch by a known account id, and ids are random and never shown across accounts. The wider
  way in, a known email through the sign-in functions, stays open. It cost a secret, an
  extension and a check in every query for very little.
- **The database makes the link token and a separate mail worker sends it.** The sign-in
  function would create the token itself and write the mail to a closed outbox table that only
  a mail-worker role can read. The backend would never see a link token, so code running as
  `player_app` could no longer sign in as a known email (the passkey path would stay as it is).
  This is the stronger design and the only one that makes "the backend cannot switch account"
  nearly true. Not chosen for PL2: it adds a role, a worker and a queue. It can be added later
  without changing the tables or the tokens, and is the first thing to revisit if the bound in
  section 9 is judged too wide.
- **A schema or a database per account.** Strong, but heavy to migrate and to pool for many
  small accounts.
- **Token lookups through a policy on the hash instead of functions.** Possible, but it spreads
  the exception over many policies. A fixed list of named functions is easier to review and test.
- **Storing live sessions in the database.** Not needed for one process, and it would store
  rider data. The plan keeps them in memory.
- **Only polling, or only notifications, for revocation in the live process.** A notification
  can be missed and a poll alone is slow. Both together give a prompt path and a bound.

## Consequences

- PL2 can be built from this document: tables, roles, grants, functions, endpoints, limits and
  guard tests are named. PL8 adds the live part without changing the rest.
- The backend sends mail (sign-in links and notices). Tests use a fake. A real mail service is
  the owner's to choose before the first deploy.
- The database needs three roles, created by the database's init script as the bootstrap
  superuser, and no extension. Much of the sign-in logic lives in SQL functions, which need
  their own tests, and every change to them is security-critical.
- The database does not contain a compromised backend (section 9). The design relies on
  parameterised SQL and its guard test for that, and says so.
- The backend's grants are per table, not uniform. A new flow that needs a new right changes
  the grant table and its guard test in a security-critical pull request.
- Audit events are append-only for the backend. An event leaves only by retention or with its
  account.
- A rider whose phone was without a connection for 5 minutes joins again and types the
  nickname again.
- The live process reads the database for credentials and audit events. It needs the database
  to start a session, not to keep the room screen running.
- An account is as safe as its mailbox, because the email link is the way back in.
- A device that was offline for more than 180 days is paired again. It keeps its cache.
- Restarting the live process, or the app that hosts, ends the live session. The app starts a
  new one, which replaces its old one. The room screen does not depend on it.
- Someone in the room who wants to can stop control by code, or late joins from the studio's
  address, for as long as they keep at it. Control by sign-in is the way round the first.
- Riders see nothing of each other, not even how many they are. The handlebar companion shows
  no rider data.
- An app with one display cannot offer a control code; the instructor signs in on the phone.
- The limits counted inside the `auth_*` functions, the link's 15 minutes, the session
  lifetimes and the cap of 20 sessions are constants in those functions (principle 7).
  Changing one is a migration that replaces a function body, so it is a security-critical pull
  request with a top-tier Reviewer. The per-address limit on link requests (10 an hour) is a
  constant in the backend's sign-in rules (`login_policy.py`); changing it is also a
  security-critical pull request. The other limits are settings, and raising one is a normal
  change. Removing a guard test is never a normal change.

**Defaults chosen here that the owner may want to change.** Each is a setting or a small,
separate change; those held by the database (principle 7) change by migration. None needs
an answer for work to go on.

| Default | Why the owner may care |
|---|---|
| Sign-up by allowlist (`SIGNUP_MODE`) | Who can create an account |
| Sign-in links work only in the browser that asked (`LOGIN_LINK_SAME_BROWSER`, on) | A user who opens the mail on another device must ask again there. Turning it off is more convenient and less safe |
| No local lock on a shared studio computer | Anyone at that computer can open the classes of every instructor paired on it. A lock (a PIN per account) would be a new feature |
| The pairing code is typed, not carried in a link | One more step when pairing |
| The token prefix `cbp_` | Follows the product's name (decision 12) |
| Session lifetimes (14 days idle, 60 days in total); device idle limit (180 days) | How often people sign in or pair again |
| Client addresses shortened in audit events; events kept 180 days | What the user and the operator can see afterwards |
| Riders see no rider count; the companion shows no rider data | Stricter than rule 13 requires |
| A deleted account leaves no marker (section 12) | The reading of plan section 5 chosen here |
| A mail service, and who is on the allowlist | Both are the owner's to provide before the first deploy |
