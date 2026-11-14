# 0010. Instructors sign in with their classbeat account

Status: Proposed (owner direction 2026-11-14)

Amends [ADR 0002](0002-accounts-sign-in-pairing-and-tokens.md), sections 4, 5, 7 and 12, and plan
section 5 ("Accounts"). Riders are unchanged ([ADR 0007](0007-riders-in-a-live-session.md)).

## Context

The owner, 2026-11-14:
- "A classbeat account is required to run classbeat-player. Same user, same account, same login
  reused."
- "A class participant however is not required to have a classbeat account. Or ... users can
  sign up to a player account only and become a read-only user, a follower."

Today the player has accounts of its own (ADR 0002 section 4). An account signs in with an email
link or a passkey, and is linked to classbeat as a source through an OAuth-shaped flow with PKCE
(section 7). Riders join a live class with a code and a nickname and have no account at all
(ADR 0007).

classbeat today is an OAuth and OIDC *client* (of Google, GitHub and Microsoft), not a provider.
Its users have a UUID `users.id`, a cookie session, a 10-minute re-authentication rule for
sensitive actions, and optional TOTP step-up. Nothing in classbeat issues tokens to another
product yet. The two repositories share no code and no database (plan section 1).

## Decision

### 1. Who has which account

| Person | Account | Signs in with |
|---|---|---|
| Instructor (runs classes, pairs studio computers, receives classes from classbeat) | A player account tied to exactly one classbeat user | Their classbeat account ("Sign in with classbeat") |
| Rider in a live class | None | Join code and nickname, as in ADR 0007 |
| Follower (a read-only player account without classbeat) | Not built. Kept open for a later ADR, which says what a follower reads | The player's own sign-in (email link, passkeys), which stays in the code for this |

`accounts` gains `kind` (`instructor`, with `follower` reserved) and, for an instructor, the
identity `(classbeat_issuer, classbeat_subject)`: unique, never changed, never null for an
instructor. Every existing rule keyed on the account id is unchanged.

### 2. The protocol

- **OpenID Connect authorization-code flow with PKCE (S256).** classbeat is the provider and the
  player's backend is a confidential client. The client is authenticated at the token endpoint
  with a client secret held as a secret file (`PLAYER_SECRETS_DIR`), never in a setting, the
  repository or a log.
  - PKCE is used as well, so a stolen code is useless without the verifier.
  - The secret is the player server's own credential at classbeat. It is not a Spotify secret,
    and no other product's secret is involved.
- **Browser binding.** The player starts the flow from the site, sets a `__Host-` browser cookie
  holding a fresh random value, and stores its hash with `state`, `nonce`, the verifier and the
  exact redirect address. The callback requires that cookie, a matching `state`, single use, and
  at most 10 minutes of age. The code and `state` arrive in the query string of the callback, as
  the code flow requires. That is the second permitted exception to ADR 0002 principle 3, with the
  same limits as the source link code: short-lived, single use, useless without the verifier.
- **The ID token.** Signed (ES256 or RS256), verified against classbeat's published keys, which
  the backend fetches only from the configured issuer. The check covers `iss` (exact), `aud` (the
  player's client id), `exp`, `iat` (within 5 minutes), `nonce` and `auth_time`.
  - The identity is `(iss, sub)`, with `sub` being classbeat's `users.id`.
  - **The email is display only.** It is never used to find, create or merge an account.
- **Who may sign up.** The first sign-in through classbeat creates the instructor account. The
  allowlist still applies (ADR 0002 section 4), now keyed on the classbeat subject or on the
  verified email classbeat reports. Which one is the operator's choice per entry. The mode stays
  held by the database (ADR 0002 principle 7).
- **Recent sign-in.** The player's 10-minute rule is now met by a fresh classbeat authentication.
  It covers passkeys, export, deletion, "sign out everywhere" and confirming a pairing code. The
  player sends `max_age=600` and checks `auth_time`. classbeat applies its own step-up (TOTP)
  when the user has it.
- **Sessions on the site.** These are unchanged (ADR 0002 section 5): the player issues its own
  `__Host-cbp_session` after a successful callback. No classbeat cookie, token or ID token is ever
  given to the browser or kept after the check, apart from `sub`, `iss` and `auth_time`.

### 3. Linking classbeat as a source

The source link of ADR 0002 section 7 stays as it is, with two additions:
- classbeat sends `login_hint=<its user id>` with the link request. The player refuses to approve
  a `classbeat` link unless the signed-in account is the instructor with that subject. The hint
  grants nothing. It only stops a class going to the wrong account.
- A player account that is not an instructor cannot approve a `classbeat` link.

Because the instructor is already signed in to both, the link is one click with no new sign-in.
Publishing keeps its own source token, a separate credential with one scope (ADR 0002 principle
2). A sign-in grants no publishing, and a source token grants no sign-in.

### 4. Lifecycle

- **classbeat account deleted.** classbeat calls a new source endpoint,
  `DELETE /api/source/account`, with the source token, before it deletes its own rows. The player
  then deletes the account fully, as in ADR 0002 section 12. If classbeat cannot reach the player,
  it retries. A player account whose classbeat identity no longer signs in stays inaccessible, and
  is deleted by the existing idle purge.
- **Existing player accounts.** There is no automatic match by email. An operator command links
  an existing account to an `(iss, sub)` once, on the owner's request. Test accounts are deleted.
- **classbeat unreachable.** New sign-ins and pairing confirmations wait. Existing site sessions,
  paired devices and the class cache keep working, and a studio can still run its synced classes
  offline (plan section 5).

### 5. The player's own sign-in

The email link and passkeys stay built and tested, and are closed for instructors. A database-held
setting refuses them for `kind = instructor`, and no follower kind is enabled yet. The player
therefore needs **no mail service** until followers exist. Re-opening them is the follower ADR's
decision.

## Alternatives

- **Keep separate accounts and link them** (the state before this ADR). Two sign-ins for one
  person, which the owner rejected.
- **Share classbeat's database or session cookie.** Ruled out by plan section 1 (no shared
  database) and by cookie scoping: the products sit on different origins, and a session must never
  cross them.
- **Plain OAuth plus a user-info call instead of OIDC.** It gives the same identity with one more
  call and no signed statement of `auth_time`, which the recent-sign-in rule needs.
- **Match existing accounts by email.** That would let anyone who controls a classbeat account
  with that email take over a player account. Refused.
- **A public client with PKCE only.** Possible, but the player's backend can hold a secret, and a
  confidential client gives classbeat one more check on who is asking.

## Consequences

- **classbeat (phase PL3, in its own repository and under its own rules)** becomes an OIDC
  provider. It needs a client registry with exact redirect addresses, an authorize endpoint on its
  cookie session with consent and `max_age`, single-use codes bound to client, redirect and PKCE,
  a token endpoint, signing keys and published key and discovery documents, rate limits, security
  events, revocation, and the account-deletion call. All of it is security-critical there.
- **Player backend.** The "Sign in with classbeat" callback, the `kind` and identity columns (a
  migration), the instructor check on `classbeat` links, the `login_hint` check,
  `DELETE /api/source/account`, the operator link command, and closing the email link and
  passkeys for instructors. Guard tests are extended, never loosened. All of it is
  security-critical.
- **Website.** The sign-in page offers "Sign in with classbeat". The account page shows the
  classbeat identity. These need a Design review.
- **The owner.** Gives the player's client registration at classbeat (issuer address, client id,
  redirect address) and its secret file when deploying. A mail service for the player is no longer
  needed before the first deploy.
- **Riders.** Unchanged.
