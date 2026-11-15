# 0010. Instructors sign in with their classbeat account

Status: Proposed (owner direction 2026-11-14)

This ADR amends [ADR 0002](0002-accounts-sign-in-pairing-and-tokens.md) in the places listed in
section 9 below, each marked there with an inline "amended by ADR 0010" note. It also amends
[ADR 0006](0006-sign-in-link-return-entry.md) and [ADR 0008](0008-the-player-as-a-web-app.md)
(return entries, section 6) and plan section 5 ("Accounts") and section 13, decision 5. Every
other part of those ADRs stands. Riders are unchanged ([ADR 0007](0007-riders-in-a-live-session.md)).

## Context

The owner, 2026-11-14:
- "A classbeat account is required to run classbeat-player. Same user, same account, same login
  reused."
- "A class participant however is not required to have a classbeat account. Or ... users can
  sign up to a player account only and become a read-only user, a follower." Then: "ok, no
  account is good too."

Today the player has accounts of its own (ADR 0002 section 4). An account signs in with an email
link or a passkey, and is linked to classbeat as a source through an OAuth-shaped flow with PKCE
(section 7). Riders join a live class with a code and a nickname and have no account (ADR 0007).

classbeat today is an OAuth and OIDC *client* (of Google, GitHub and Microsoft), not a provider.
Its users have a UUID, a cookie session, a 10-minute re-authentication rule for sensitive actions,
and optional TOTP step-up. Nothing in classbeat issues tokens to another product yet. The two
repositories share no code and no database (plan section 1). The player has not been deployed, so
no real account exists yet.

## Decision

### 1. Who has which account

| Person | Account | Signs in with |
|---|---|---|
| Instructor (runs classes, pairs studio computers, receives classes from classbeat) | A player account tied to exactly one classbeat user | Their classbeat account ("Sign in with classbeat") |
| Rider in a live class | None | Join code and nickname, as in ADR 0007 |
| Follower (a read-only account without classbeat) | Not built. A later ADR says what a follower reads | Reserved: the player's own sign-in (section 7) |

`accounts` gains:
- `kind`: `instructor`, `unlinked` (section 8), with `follower` reserved and not accepted by any
  function yet;
- for an instructor, the identity `(classbeat_issuer, classbeat_subject)`: unique, never changed,
  required for `kind = instructor`, a database constraint.

Every rule keyed on the account id is unchanged.

### 2. The flow

OpenID Connect authorization-code flow with PKCE (S256). classbeat is the provider; the player's
backend is a confidential client, authenticated at the token endpoint with `client_secret_basic`.
The secret is a secret file (`PLAYER_SECRETS_DIR`), never a setting, the repository or a log. It
is the player server's own credential at classbeat; no other product's secret is involved.

1. **Start.** The sign-in page sends `POST /api/site/sign-in/classbeat/start` (a script request
   under the cross-site rules of ADR 0002 section 5), with an optional return entry (section 6).
   The server:
   - issues a **binding token** `cbp_cbs_<secret>` (ADR 0002 section 2 format) in the cookie
     `__Host-cbp_cbsign`; `Secure`; `HttpOnly`; `SameSite=Lax`; `Path=/`; `Max-Age=600`;
   - makes `state` and `nonce`, 32 random bytes each, base64url;
   - stores, through `auth_start_classbeat`, one row in the closed table `classbeat_sign_ins`:
     the binding token's hash, the hashes of `state` and `nonce`, the purpose (`sign_in` or
     `reauth`), the return entry, for `reauth` the asking session's hash, and the time. Nothing
     is stored in clear. A start from a browser that already holds a binding cookie deletes that
     cookie's row first, so a browser has at most one flow open;
   - answers the authorize address. The page's script navigates there (as ADR 0002 section 7
     step 4); no form is submitted and `form-action 'self'` is not widened.

   The binding token itself is the PKCE verifier (it is 51 characters of the verifier alphabet).
   The `code_challenge` is base64url(SHA-256(token)), so the server needs no clear copy of it.
   The authorize request carries `response_type=code`, `client_id`, the exact registered
   `redirect_uri`, `scope=openid email`, `state`, `nonce`, `code_challenge`,
   `code_challenge_method=S256`. A plain sign-in sends no `max_age`: classbeat's own session is
   enough. A re-authentication (section 5) adds `prompt=login`. No `offline_access`, so no
   refresh token is asked for.
2. **Callback.** `GET /api/site/sign-in/classbeat/callback?code=…&state=…`. This is the one GET
   that changes state on the site (section 9 lists the amendment to ADR 0002 section 5). It is
   accepted only as a top-level navigation: when `Sec-Fetch-Mode` is present it must be
   `navigate`, and when `Sec-Fetch-Dest` is present it must be `document`. A request with an
   `error` parameter, or without the cookie, or with a `state` that does not match a row bound
   to that cookie, or a row older than 10 minutes, does nothing more. The server then, in this
   order:
   1. uses up the row (`auth_take_classbeat`, single use, by binding hash and `state` hash
      together) and clears the binding cookie;
   2. calls classbeat's token endpoint with the code, the `redirect_uri` and the binding token
      as `code_verifier`. The binding is spent by then, so its value is useless to anyone who
      sees it later;
   3. checks the ID token (section 3), and discards the access token and any refresh token
      unread. No user-info call is made;
   4. completes the sign-in (section 4) or the re-authentication (section 5);
   5. answers `303` to a clean site path: the return entry's page (section 6) or `/classes`.
      The code and `state` are never in a later address, and every page has
      `Referrer-Policy: no-referrer`.

   Every refusal answers the same `303` to `/sign-in#error=classbeat`, with no reason in the
   address; the reason goes to the audit event where an account is known ("Audit events" in section 9).
3. **Log hygiene for the callback.** The backend's access log writes method, path and status
   only, never the query string (as built). The deploy runbook requires the host's reverse proxy
   to log no query string for `/api/site/sign-in/classbeat/` and `/link/source`, and a test asserts that no log
   line of a callback request holds its `code` or `state`. Errors on the route never echo a
   parameter.

### 3. The ID token check

All values below are constants in the backend's sign-in rules (`classbeat_policy.py`, a pure
module), changed only in a security-critical pull request.

- **Algorithm.** `ES256` only, a constant. The header's `alg` must equal it; `none`, every `HS*`
  and every other value are refused before any key is looked at. The algorithm is never taken
  from the token.
- **Type.** An ID token's header `typ`, when present, is `JWT`; a token typed `logout+jwt` is
  refused at the callback. An event token (section 8) must be typed `logout+jwt`.
- **Key.** The header's `kid` must name exactly one key in the cached key set, with `kty` `EC`,
  `crv` `P-256`, and `use` `sig` and `alg` `ES256` where present.
- **Claims.** `iss` equals the configured issuer exactly. `aud` is the client id, or an array
  holding only it. `azp`, when present, equals the client id. `exp` is in the future and `iat`
  not more than 5 minutes old, each with 60 seconds of allowed clock difference. `nonce` hashes
  to the row's nonce hash. `sub` is present, at most 255 characters. `auth_time` is present and not later than now plus
  60 seconds.
- **Email.** `email` and `email_verified` are read. The email is kept only when
  `email_verified` is `true`, for display and the security mails (section 7). It is never used
  to find, create or merge an account, except for the allowlist match in section 4.
- **Endpoints and keys.** The issuer, the authorize, token and key-set addresses are settings,
  not discovered at run time. Each must be HTTPS on the issuer's exact origin; the backend refuses
  to start otherwise. A deploy check reads classbeat's discovery document and fails unless its
  `issuer` and endpoints equal the settings. The key set is fetched at start and cached at most
  24 hours. A token naming an unknown `kid` triggers one refetch, at most once per 5 minutes.
  A failed fetch keeps the cached keys until they are 24 hours old. Every call to classbeat
  follows no redirect, times out after 5 seconds and reads at most 64 KiB.

### 4. Sign-in and sign-up

`auth_complete_classbeat(issuer, subject, email, email_verified, auth_time, session_hash)`, a new `auth_*`
function, does the following in one transaction:
- **An instructor with that identity exists:** a new session is issued (ADR 0002 section 5: a
  new token at every sign-in, and the browser's earlier session is ended through
  `asking_session`). The session's "last signed in" is the token's `auth_time`. The account's display email is replaced by the verified one, or kept when
  none is verified.
- **No such instructor:** an account is created only if sign-up allows it (`SIGNUP_MODE`, held
  by the database). In `allowlist` mode an entry of `signup_allowlist` matches either:
  - its subject, equal to `(issuer, subject)`; or
  - its email, equal to the token's email **with** `email_verified` true, and only while the
    entry has no bound subject. The first sign-in that uses an email entry binds the entry to its
    identity, so a classbeat email later freed and taken by another person does not match again.
- Otherwise nothing is created, and the limits of ADR 0002 section 10 count it ("Limits" in
  section 9).

Entries by email are the normal way to let an instructor in. An entry by subject needs the
pairwise subject classbeat issues for the player's client, which classbeat's operator reads from
classbeat's own admin tools. The player's logs and audit events hold no subject.

The identity is `(iss, sub)`. classbeat issues a **pairwise** `sub` for the player's client (a
value derived from its user id and the client, not the user id itself), so the subject the
player stores and sees in URLs is not classbeat's internal id.

### 5. Recent sign-in

The 10-minute rule of ADR 0002 section 4 is met by a fresh classbeat authentication. It covers
export, account deletion and "sign out everywhere"; passkeys are closed for instructors
(section 7).

- A session that needs it starts the flow with purpose `reauth`. The row holds the asking
  session's hash, and the callback requires the same session cookie.
- The ID token's `(iss, sub)` must equal the asking account's identity. Otherwise the result is a
  refusal (`reauth.refused` on that account), and no session changes.
- On success, `auth_reauth_classbeat(asking_session_hash, issuer, subject, auth_time,
  session_hash)` checks the identity against the asking session's account and issues a new
  session with "last signed in" set to the token's `auth_time`, as a sign-in does; the asking
  session is ended. The page then returns to where it asked. A refusal changes no session.
- A recent sign-in holds while now − `auth_time` ≤ 600 seconds, checked when the sensitive action
  is asked, with no clock allowance beyond that. `prompt=login` makes classbeat authenticate the
  user again, and the callback refuses a re-authentication whose `auth_time` is older than the
  flow's start minus 60 seconds, so a fresh one always gives close to the full 10 minutes.
  classbeat applies its own TOTP step-up when the user has it.

### 6. Return entries across the round trip

The return entries of ADR 0006 and ADR 0008 (`control`, `control.XXXX-XXXX`, `play`,
`play.<class id>`) are kept in memory only on the site. The round trip to classbeat leaves the
page, so the entry travels server-side:
- the start request may carry `return_to`, checked by the existing exact pattern
  (`login_policy.py`); anything else is `422 invalid_return`;
- it is stored in the `classbeat_sign_ins` row, a closed table, and deleted with it (use, or the
  purge within the hour). It is never in `state`, an address sent to classbeat, a log line or an
  audit event;
- the callback's `303` goes to the page the site's return-entry table names, in the same form
  the site's own return uses after a sign-in: `/control`, `/control#<class code>`, `/play` or
  `/play#<class id>`. The class code or class id is in the fragment, never the query. The site's
  storage guards are unchanged.

The way back of ADR 0006 decision 5 that is not a return entry (`/pair?code=…`, other site
paths) is not carried: after a classbeat sign-in such a page is reached again by hand, and the
pairing code is typed again.

### 7. The player's own sign-in, and mail

The email link and passkeys stay built and tested, and are closed for every kind there is today.
`auth_complete_login`, `auth_complete_passkey` and passkey registration refuse every account
whose kind is not `follower`, and no function accepts `follower` yet. Re-opening them is the
follower ADR's decision.

The security mails of ADR 0002 section 6 stay: a paired device and an approved source link send
one to the account's verified display email. So the player still needs a mail service before its
first deploy, for those notices only (`docs/owner.md`). Until one is configured the mails are
dropped, as built, and the site also shows the same notices on the account page from the audit
events. An account with no verified email gets the page notices only.

### 8. Lifecycle

- **Events from classbeat.** classbeat sends the player signed events to
  `POST /api/classbeat/events`, in the form of OpenID Connect back-channel logout tokens
  (`application/x-www-form-urlencoded`, one `logout_token`). The route is for classbeat's
  server, not a browser: it takes no cookie and no other credential, and refuses a request whose
  `Sec-Fetch-Site` header is present (`403 cross_site_request`), as the app's routes without a
  credential do (ADR 0002 section 6). The token is a JWT checked as in section 3 (algorithm, key,
  `iss`, `aud`, `iat` within 5 minutes, `exp` required and in the future), with `nonce` absent, a `jti`, a `sub`
  and an `events` claim, a JSON object whose members are exactly the back-channel logout event
  `http://schemas.openid.net/event/backchannel-logout` (value `{}`) and one of these two
  (value `{}`); any other member, or both, is refused with `400 bad_event`. The names are pinned
  with classbeat (its ADR 0034):
  - `urn:classbeat:player:account-deleted` (below, `account-deleted`): the account with that identity is deleted fully, as ADR 0002 section 12
    (no recent sign-in, no typed confirmation: classbeat's user did that at classbeat);
  - `urn:classbeat:player:sessions-revoked` (below, `sessions-revoked`): every site session of that account ends (classbeat's "sign out
    everywhere", a disabled account, a credential reset), with the same "all sessions ended"
    event (detail `by: classbeat`) and `live_revocations` notice as "sign out everywhere", so a live controller taken
    with one of those sessions is dropped (ADR 0002 sections 5 and 8). Devices are not ended:
    they are read-only and revocable on the site.
  `jti` is single use: its hash is kept in the closed table `classbeat_event_ids` for 8 days. A
  repeat `jti`, or a `sub` with no account, answers `200` and changes nothing; an accepted
  event also answers `200`, as back-channel logout specifies. classbeat retries
  until it gets `2xx`, for up to 7 days, signing each attempt afresh with the same `jti`; it keeps
  only the pending event, not a player credential.
  A delivery that fails for 7 days is an operator matter at classbeat; meanwhile the account
  cannot be signed in to, because the identity no longer signs in at classbeat.
- **The source token is unchanged.** It gains no deletion scope; `DELETE /api/source/account` is
  not built.
- **Existing accounts.** The migration sets `kind = unlinked` on every existing account. An
  unlinked account cannot sign in by any method. The operator command
  `admin account link <account id> <issuer> <subject>` (run as `player_owner`, like the
  allowlist commands) makes it an instructor, once, and deletes its passkeys; or the operator
  deletes it. There is no automatic match by email. Since nothing is deployed, this concerns
  development databases only.
- **The email column.** For an instructor `accounts.email` is the display email: not unique,
  nullable, replaced at each sign-in by `auth_complete_classbeat` (a column grant to
  `player_auth`, section 9). The unique index becomes partial, for `kind = follower` only.
  `player_app` still has no `UPDATE` on `accounts`. Where an email used to be shown, a null one
  shows "your classbeat account": `auth_collect_pairing` returns the email or null, and the app
  then shows that text after pairing.
- **An event that never arrives.** If `account-deleted` is never delivered, the account cannot
  be signed in to, but a paired device in use keeps syncing its classes, since it never reaches
  its idle limit. The deploy runbook gives the operator `admin account delete <account id>`
  (run as `player_owner`) for the case classbeat's operator reports an undelivered deletion.
- **classbeat unreachable.** New sign-ins and re-authentications wait. Existing site sessions,
  paired devices and the class cache keep working, and a studio still runs its synced classes
  offline (plan section 5). Events are delivered when classbeat is back.

### 9. What this changes in ADR 0002

| ADR 0002 | Change |
|---|---|
| Principle 1 | Unchanged: the binding token is stored as a hash; `state`, nonce and `jti` too. The binding token doubles as the PKCE verifier, sent once to classbeat after the binding is used up |
| Principle 3 | Two exceptions: the source link code (as today) and the callback's `code` and `state`, which classbeat's code flow puts in the query string. Both are short-lived, single use and useless without a verifier the player holds |
| Principle 4 | The callback's query string is never logged: section 2, step 3 |
| Section 2 | Token types gain `cbs` |
| Section 3 | A new row: binding token `cbp_cbs_`, issued by the site at the flow's start; scope: complete one classbeat sign-in in the browser that asked, and serve once as its PKCE verifier; 10 minutes, single use; hash in `classbeat_sign_ins`; cookie `__Host-cbp_cbsign` (`SameSite=Lax`); revoked by use, expiry or a newer start in that browser. The session row: issued also by the classbeat callback |
| Section 4 | Sign-up and sign-in for instructors are sections 4 and 5 here; the email link and passkeys are closed (section 7) |
| Section 5 | The callback is the one state-changing GET, guarded as section 2 says. The routes that read the session cookie gain the callback (through `asking_session`, and for `reauth` to match the asking session) and `POST /api/site/sign-in/classbeat/start` (for `reauth`). The events route (`/api/classbeat/events`) reads no cookie and is outside the site's API and its `Origin` rule, guarded like the app's routes without a credential. "No form posts to, or is redirected to, another origin" stands; the site's script navigates to classbeat, as for a source link |
| Section 6 | The pairing mail stays (section 7 here). Pairing is otherwise unchanged |
| Section 7 | Steps 2, 3 and 5: a `classbeat` link needs `login_hint` and is approved only by the instructor it names; the exchange answer holds `account_subject` (section 10). Section 9's function table: `auth_new_link_code` takes `client`, `login_hint` and `issuer`, returns `wrong_account` for another account (writing `source.link_refused`) and stores the set account's `(issuer, subject)`; `auth_exchange_link_code` returns `NULL` or that pair instead of true or false; `auth_collect_pairing` returns the email or null |
| Section 9 | Closed tables gain `classbeat_sign_ins` and `classbeat_event_ids`. New functions: `auth_start_classbeat`, `auth_take_classbeat`, `auth_complete_classbeat`, `auth_reauth_classbeat` (the identity check and the session of section 5), `auth_classbeat_event` (section 8). `player_auth` gains `UPDATE (email)` on `accounts`, `DELETE` on `accounts` for `account-deleted`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the two new tables, and `UPDATE (bound_issuer, bound_subject)` on `signup_allowlist`. The guard tests' lists gain all of these. The bound in "What this stops" gains the rows below |
| Section 10 | New limits (below) |
| Section 11 | New events (below) |
| Section 12 | An account is also deleted by classbeat's `account-deleted` event |
| Section 13 | New threat rows (below) |

**The bound on a compromised backend, added to ADR 0002 section 9.** Code running as
`player_app` can call `auth_complete_classbeat` with any `(issuer, subject)` it knows and get a
session for that instructor, because the ID token is checked by the backend, not the database;
the subjects of every account are in rows it can read once it enters them. It can create an
account for any email on the allowlist that has no bound subject, by passing a made-up identity
and `email_verified` true. It can call `auth_classbeat_event` and delete an account or end its
sessions. Each leaves the audit events of ADR 0002 section 11 where the account survives. It cannot create an
account that the allowlist does not allow, or change an identity.

**Limits (ADR 0002 section 10).**

| What | Limit | Over the limit |
|---|---|---|
| Flow starts, per address | 20 per 10 minutes | 429; no row, no cookie |
| Re-authentication starts, per session | 10 per 10 minutes | 429 |
| Callbacks, per address | 30 per 10 minutes, counted before the row is looked up | `303` to the error page, with nothing used up |
| Sign-ups refused by the allowlist, per address | 10 per hour | The same refusal |
| Events from classbeat, per address | 600 per minute | 429; classbeat retries |

**Audit events (ADR 0002 section 11),** written inside the functions: signed in (method
`classbeat`); re-authenticated; `reauth.refused`; all sessions ended (with `by: classbeat`, one
event, as for "sign out everywhere"); `source.link_refused` with `wrong_account`; account linked by
the operator (written by the command). A refused sign-in with no account writes counters only.
`account-deleted` writes no event: the account's events go with it, as for every account
deletion. None holds a code, `state`, nonce, token, `jti` or subject.

**Threats (ADR 0002 section 13).**

| Threat | Answer |
|---|---|
| **A classbeat account taken over** | The player account follows: the attacker can sign in, read classes and pair devices. The player inherits classbeat's protection (its sign-in, its TOTP step-up when set). classbeat's `sessions-revoked` ends the player's sessions when classbeat resets the account; devices the attacker paired are listed on the site and revocable, and each pairing sent a mail |
| A forged sign-in or event | ES256 only, keys from the configured issuer only, exact `iss` and `aud`, single-use `jti`, `nonce` bound to the browser's row. Forging needs classbeat's signing key |
| The callback's code in a log or a link | It is in the query string by necessity. It lives as long as classbeat's code (at most 60 seconds, single use, required by classbeat's provider), works only with the verifier that only the player's server and that browser's cookie held, and the binding row is spent before the exchange. Not logged (section 2, step 3); the `303` leaves it behind with no referrer |
| Login cross-site forgery (an attacker signing a victim into the attacker's account) | The callback needs the victim browser's own binding cookie and the `state` of its own row, so an attacker's code cannot complete in another browser |
| A stolen source token | Unchanged: it publishes classes and deletes nothing beyond them |
| A replayed or delayed event | `iat` within 5 minutes, and `jti` single use for 8 days, longer than classbeat's 7 days of retries |

### 10. Linking classbeat as a source

The source link of ADR 0002 section 7 stays, with a server-side binding so that one classbeat
user can never link into another instructor's account (for example on a shared studio computer
where someone else is signed in):
- classbeat sends `login_hint=<pairwise subject>` with the link request. For source
  `classbeat` the hint is required: a link request without one is refused like an unknown
  source (ADR 0002 section 7, step 2), without redirecting.
- The site approves a `classbeat` link only when the signed-in account is an instructor whose
  issuer equals the configured classbeat issuer and whose subject equals the hint. Otherwise the
  approval answers `403 wrong_account`, no code is made, and the account gets the event
  `source.link_refused` with the reason `wrong_account`. An account that is not an instructor
  gets the same answer. The hint grants nothing.
- The check is made in the database, not by the backend: `auth_new_link_code` gains the
  arguments `client` (as the other functions that write an event), `login_hint` and `issuer`
  (both null for other sources; `issuer` is the backend's configured classbeat issuer). For
  source `classbeat` it requires an instructor account whose stored issuer equals `issuer` and
  whose stored subject equals `login_hint`. Otherwise it writes `source.link_refused`
  (`wrong_account`), stores no code and **returns** `wrong_account`; it does not raise, so the
  event is committed with the function's transaction, as every refusal in ADR 0002 section 9
  is a return value. It returns null when the code is stored. The backend answers
  `wrong_account` as `403 wrong_account` and writes no audit row itself.
- This check guards a mistake or a confused browser, not a compromised backend: code running as
  `player_app` can pass a matching `login_hint` and `issuer`. The guard against that is
  classbeat's `account_subject` check below.
- `auth_new_link_code` stores, with the code, the `(issuer, subject)` of the account already set. `auth_exchange_link_code` returns nothing (`NULL`) on a refusal,
  and on success the link's `(issuer, subject)`. The answer of `POST /api/source/token` holds
  it as `account_subject: {"iss": …, "sub": …}`.
- classbeat keeps the link only if `account_subject` equals both classbeat's own issuer (the one it
  signs ID tokens as) and
  the pairwise subject of the classbeat user who started the link. Otherwise it ends the link at
  once with `DELETE /api/source/link`. That leaves `source.linked` then `source.revoked` in the
  account the link reached, and its owner gets the link mail, which tells them what happened.
- The subject is pairwise, so no classbeat user id is in a link URL. The link URL, with the
  hint, stays in the browser's history; it grants nothing. The reverse proxy logs no query
  string for `/link/source` either (section 2, step 3). A sign-in grants no publishing, and a
  source token grants no sign-in (ADR 0002 principle 2).

## Alternatives

- **Keep separate accounts and link them** (the state before this ADR). Two sign-ins for one
  person, which the owner rejected.
- **Share classbeat's database or session cookie.** Ruled out by plan section 1 and by cookie
  scoping: the products sit on different origins, and a session never crosses them.
- **Plain OAuth plus a user-info call.** No signed `auth_time`, which the recent-sign-in rule
  needs, and one more call.
- **Match existing accounts by email.** Anyone controlling a classbeat account with that email
  would take over a player account. Refused.
- **A public client with PKCE only.** The backend can hold a secret, so it does.
  `private_key_jwt` would replace the shared secret with a key pair; it is a later hardening.
- **`DELETE /api/source/account` with the source token** (the first draft of this ADR). It widened
  a long-lived credential held by another product into account deletion, and covered only
  instructors who had linked classbeat as a source. The signed events reach every instructor and
  widen no token.
- **Storing the PKCE verifier and nonce in the row.** Clear secrets in a table; the binding token
  as verifier and a nonce hash need none.

## Consequences

- **classbeat (phase PL3, in its own repository and under its own rules)** becomes an OIDC
  provider: a client registry with exact redirect addresses, pairwise subjects, an authorize
  endpoint on its cookie session with consent and `prompt=login`, the source-link binding of
  section 10 (`login_hint` and the `account_subject` check), codes of at most 60 seconds bound to
  client, redirect and PKCE, a token endpoint, ES256 signing keys, key-set and discovery
  documents, rate limits and security events, and the signed event delivery of section 8 with
  retries. All of it is security-critical there.
- **Player backend (security-critical):** the start, callback and events routes, the two closed
  tables and five functions, `kind`, the identity and the email change (a migration),
  `classbeat_policy.py`, the closing of the email link and passkeys, the operator commands
  `admin account link` and `admin account delete`, the `login_hint` check and the changed
  `auth_new_link_code`, `auth_exchange_link_code` and `auth_collect_pairing` (section 10), and
  the guard tests extended, never loosened.
- **Website:** "Sign in with classbeat" on the sign-in page, the re-authentication step, the
  account page's identity and notices. These need a Design review.
- **Desktop app:** after pairing it shows "your classbeat account" when the email is null.
- **Deploy runbook:** `admin account delete` for an undelivered deletion (section 8); the
  classbeat settings, the client secret file, and the reverse proxy's
  rule of section 2, step 3.
- **The owner** gives the player's client registration at classbeat (issuer, client id, redirect
  address, events address) and its secret file when deploying, and still a mail service, now for
  security notices only.
- **Later, not decided here:** an `amr` or `acr` claim so the player can see classbeat's step-up;
  the follower ADR.
- **Riders.** Unchanged.
