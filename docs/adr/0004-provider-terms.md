# 0004. Provider terms

Status: Accepted when this pull request merges (2026-11-12), by the Orchestrator under the frozen
plan. It records operating rules only: what the product does and does not do with other
companies' services and data. It contains no legal analysis and none may be added to it
(AGENTS.md, section 6).

## Context

Plan section 11 requires a written decision on providers before any build. classbeat already
runs under its own provider decision: an invite-only, free, non-commercial beta. This product
adds three things classbeat does not have: Spotify-derived song details stored in a second
service and on users' devices, visuals shown in time with Spotify playback, and use in a studio.

The rules this ADR turns into checkable operating rules come from the plan's product rules
(section 3, rules 1 to 3), the music link (section 4, ADR 0001), the class format (ADR 0003) and
the owner's open decisions 9 to 13 (section 13). Which companies are involved: Spotify (the
music the instructor plays), MOWL (where classbeat gets music analysis and still saves classes),
Swedebeat (a licensed music provider, later) and classbeat (our own class source).

## Decision

### 1. Distribution while decisions 9 to 13 are open

- The product is **invite-only, free and non-commercial**. There is no payment code, no price, no
  paid plan and no advertising anywhere in the repository.
- New accounts are created only for email addresses on the backend's allowlist (the sign-up
  mode default of ADR 0002). Open sign-up is off by default and needs the owner's decision.
- Releases are published to GitHub Releases (AGENTS.md, section 1). No app store listing is made
  without the owner (decision 9).

### 2. Spotify

- **What is stored.** Only what classbeat sends in a class document (ADR 0003): song title,
  artist, duration, the song's window in class time, and the optional Spotify track id and ISRC.
  The backend stores them as part of the class; the player keeps them in its offline class cache.
  Nothing else from Spotify is stored: no cover art, no audio, no audio features, no playlists,
  no user data, no tokens.
- **Audio, never.** No code downloads, records, captures, stores, caches, streams or plays
  Spotify audio, on the device or on the server (rule 3). A Reviewer rejects any dependency or
  code path that captures system audio.
- **No Spotify developer interface in option A.** The player follows the Spotify desktop app
  through the operating system's local interfaces only (ADR 0001). There is no Spotify client id,
  client secret, OAuth flow, Web API call or Web Playback SDK in the repository.
- **Option B only by a new ADR.** Adding the Spotify Web API or SDK for anyone needs a new ADR that
  replaces this section, and the owner's decision.
- **Cover art and brand** (a default of this ADR; the plan is silent). The player shows no Spotify logo, cover art or Spotify branding. The
  song is shown as plain text: title and artist.
- **Transport control** (play, pause, next) is sent only to the music app on the same computer,
  through the same local interfaces, never through a Spotify server.

### 3. Studio use

- Text in the product says that the music played in a class comes from the instructor's own
  music service and is the instructor's responsibility. Where that text appears (sign-up,
  first start, help) is a design decision; **its wording is the owner's** (AGENTS.md, section 1).
  Until the owner supplies it, agents use a placeholder marked `OWNER TEXT` and ship nothing
  that claims more.
- The product never says or implies that it licenses music, or that it is endorsed by Spotify,
  MOWL or Swedebeat.

### 4. MOWL

- **Nothing of MOWL is used by this product.** No code, API, account, credential, asset, name,
  palette or screen design of MOWL (rule 6). The backend and the player never call a MOWL server.
- classbeat stays the only party that talks to MOWL. What reaches this product is classbeat's own
  class document (ADR 0003), never MOWL's data in MOWL's format.
- Nothing in the repository refers to MOWL except the plan and ADRs, where it is named for
  comparison.

### 5. Swedebeat

- **No Swedebeat playback** until phase PL11 has its own ADR and the owner has answered
  decision 11. Until then the manual clock is the Swedebeat mode: the mix plays from Swedebeat's
  own app and the instructor starts the player with it (plan section 4).
- A class document may carry a `swedebeat_mix` id (ADR 0003). The player shows it and does
  nothing else with it.
- No credentials or keys taken from Swedebeat's or any other company's app are ever used
  (AGENTS.md, section 8).

### 6. Contacting providers

Contacting Spotify, MOWL, Swedebeat or any other company, and signing up for any provider
developer programme, is the owner's alone (AGENTS.md, section 1). An agent that needs something
from a provider writes it in `docs/owner.md` and carries on.

### 7. Checks

- A rule guard test in each lane that has dependencies fails the build if a dependency or source
  file brings in a Spotify Web API or SDK client, a system-audio capture library, or a known
  MOWL endpoint host. The list it checks is kept in one file and only grows.
- Reviewers list sections 2, 4 and 5 of this ADR in the verdict of every rule-sensitive pull
  request that touches music handling, provider data or the class cache.

### 8. What reopens this ADR

- Any owner decision on payment, openness or distribution (decisions 9, 12 and 13).
- Adding option B (section 2).
- PL11 and the owner's answer on Swedebeat (decision 11).
- Any new music provider or new class source.

## Alternatives

- **Rely on classbeat's provider decision alone.** Not enough: it does not cover storage in a
  second service, visuals in time with playback, or studio use (plan section 11).
- **Leave provider rules to each pull request.** Not checkable with no person in the loop; the
  rules must be written once and enforced by tests and review (AGENTS.md, section 6).

## Consequences

- Every lane has a short, fixed list of what it may and may not do with provider data, and the
  Reviewer has a list to check against.
- Song details travel only inside class documents, so the class format is the single place where
  provider data enters the product.
- Product text about music use waits for the owner's wording; screens that need it ship with a
  marked placeholder.
- A change of distribution, a payment plan or a new provider is an ADR change, not a code change
  hidden in a pull request.
