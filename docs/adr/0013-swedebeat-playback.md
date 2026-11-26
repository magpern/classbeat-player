# 0013. Swedebeat playback: sign-in, an encrypted mix cache and exact timing

Status: Proposed. Becomes Accepted when a Reviewer passes its pull request. Everything it decides
is built and tested on fakes; the real source of the audio stays off until the owner answers
plan decision 11 (section 2).

## Context

Plan phase PL11: "play a mix while downloading it to an encrypted cache on the device; exact
timing", gated on "Swedebeat's agreement and a sanctioned source of the audio; its own ADR". This
is that ADR. It rests on:

- **Plan section 4, option E** and "Swedebeat: the player plays the mix itself" (owner,
  2026-11-12): a mix is one long file; when the player plays it the position is exact, there is no
  link to lose, and a cached mix plays with no network. The audio goes from the provider straight
  to the device, never through our backend. The cache is encrypted, tied to the signed-in
  account, usable only by the player, and removed when the class is removed or the account signs
  out.
- **Plan decision 11**, open: where the audio comes from. The owner closed one route on 2026-11-26: the player
  is not associated with any other cycling product and never gets audio through one (ADR 0004,
  section 4). Until a source is named, "the manual
  clock stays the Swedebeat mode" (plan section 4; ADR 0001, option D; ADR 0004, section 5).
- **Plan section 3, rule 3**: Spotify's music stays in Spotify's own app; the player never
  downloads, stores or plays it. Audio from a licensed provider that allows it (Swedebeat) may be
  played by the player. No class audio is ever streamed from our server.
- **AGENTS.md section 8**: passwords are never stored; tokens live in the operating system's
  keychain on a device; tests never touch the network or a real account; no credentials taken
  from another company's app.
- **ADR 0002 section 6 and `core/pairing/keychain-policy.ts`**: the device token is kept through
  Electron's `safeStorage`, and a computer with no usable keychain (Linux `basic_text`) does not
  pair. **ADR 0010**: the player's own sign-in is classbeat's; this ADR adds a second, separate
  sign-in to a music provider and changes nothing in ADR 0010.
- **ADR 0003**: a song may carry `ids.swedebeat_mix`, and `music.source` may be `swedebeat`, but
  nothing says that a class was designed against one whole mix with known length. **ADR 0004
  section 5**: the player shows a `swedebeat_mix` id and does nothing else with it.
- **classbeat's precedent** (its ADRs 0035 and 0036): classbeat reaches Swedebeat only through
  the owner's Swedebeat gateway, which holds every Swedebeat secret; agents never call a real
  gateway, whatever its URL. The same discipline applies here: agents and tests never call a
  real Swedebeat service or gateway. Whether such a gateway has any part in the player is not
  decided here; it is part of plan decision 11 (section 2 and Consequences).

## Decision

### 1. Sign-in: credentials once, on our own page; the token in the keychain

- **Where.** Sign-in is offered only on the class list page (`classlist.html`), never in the room
  window, which runs the scene, or the presenter window. `core/ipc-policy.ts` admits the new
  channel `player:mix-sign-in` from the class list page only, as it does for the existing
  `player:` channels. While the state is `off` (`UnavailableMixSource`, section 2) the page shows
  no username or password field at all, only "Swedebeat playback is off".
- **What is typed.** The credentials are defined by the source (section 2): with the fake, a
  username and a password. The real source's sign-in may need a different form, or no password on
  the device at all; issue 4's page is therefore provisional, built against the fake, and is
  revisited with issue 7. The main process refuses input over 256 characters per field, or more
  fields than the active source declares.
- **Once, never kept.** The renderer hands the credentials to the main process in one call; the
  main process passes them to the configured `MixSource`'s `signIn` and drops them. A password is
  never written to disk, a log, a crash report, a URL, a setting, the class cache, the backend or
  any model, and is never sent back to a renderer. The IPC handler holds it in one local variable
  for the length of the call; the page clears its fields on submit, success or failure.
- **The token.** What comes back is a **Swedebeat token**, opaque to the player. It is kept only
  through `safeStorage` (the operating system's keychain), in a file only that user can read,
  under the classbeat-player account it was connected for. `keychainUsable` decides as for
  pairing: with no usable keychain the page says so and does not offer sign-in; there is no
  plain-text fallback.
- The token stays in the main process. No renderer, preload, IPC answer, log line, error text or
  status message carries it, or the source's origin and paths. Renderers see only a state:
  `disabled`, `signed_out`, `signing_in`, `signed_in`, `refused`. (As built: the design spec's `off` is
  `disabled` in code, `MixState` in `core/mix/view.ts`, and `unavailable` is a refusal reason, not a
  state.)
- **One key lifetime.** The account's cache key (section 3) lives from the account's first mix
  until **sign-out of Swedebeat, unpairing that account, or the account's deletion reaching the
  device**, and only those end it. Each of them deletes, in this order: the cache key from the
  keychain, then the token, then the account's mix folder, so a crash between steps leaves only
  files that can no longer be decrypted, and the next start deletes them.
- **An invalid token.** A source answer that the token is no longer valid deletes the token only.
  The cache key and the mixes stay, and nothing plays them, because the mode policy (section 4)
  selects mix playback only while the account holds a token. The page shows "Connect Swedebeat
  again"; signing in again makes the kept mixes playable without a new download. Eviction
  (section 3) still applies meanwhile.
- A user signs in again by entering the credentials again. There is no "remember me", no refresh
  secret held beyond what the source returns as its one token, and no second copy of the token.

### 2. A `MixSource` interface; the real source is off and owner-gated

All access to Swedebeat goes through one interface in `player/app/src/core/mix/source.ts`
(types only, no I/O):

| Call | What it does |
|---|---|
| `credentialFields()` | The fields the source's sign-in asks for (the fake: username, password); empty when it has no sign-in on the device |
| `signIn(credentials)` | Returns a token or a typed refusal (`bad_credentials`, `unavailable`, `rate_limited`) |
| `signOut(token)` | Best effort; the local deletion of section 1 happens whatever it answers |
| `describe(token, mixId)` | The mix's byte length, its duration in ms as the source states it, an optional SHA-256 of the file or the source's version of it, and whether this account may play it |
| `read(token, mixId, fromByte)` | A byte stream from `fromByte` to the end |

**Audio path (plan section 3, rule 3).** Whatever source is chosen, the audio bytes go from the
provider straight to the device. No class audio is ever streamed from, through or by a server of
ours. A source may at most authorize the device or hand it the provider's own link; a route that
would need the bytes through a server of ours is not a source under this ADR and goes to
`docs/owner.md` instead.

Implementations:

- **`FakeMixSource`** (tests, CI, the screenshot harness and the developer build): serves a
  generated, licence-free test tone file from the test fixtures, scripts every refusal, slow
  and stalled reads, a wrong length and a changed file, and records what it was asked.
- **`UnavailableMixSource`**, the default in every shipped build: `credentialFields` is empty and
  `signIn` and `describe` answer `unavailable`. With it the Swedebeat mode is the manual clock,
  exactly as today.
- **The real source is not chosen or built here.** Which source supplies the audio is plan
  decision 11's answer, the owner's. When the owner answers, a separate issue adds that client
  behind this interface, in the main process, with its origin a setting that defaults to empty
  (off), `https:` only, the host pinned by the setting and every request built by one module. No
  credential or key taken from Swedebeat's or any other app is ever used (AGENTS.md
  section 8).
- **Agents never call a real source.** No test, script, fixture, CI job or developer default names
  a real Swedebeat or gateway host. Issue 3 adds:
  - a **network guard** for the player's unit tests (and its end-to-end tests where they run
    Node code), on the model of `backend/tests/netguard.py`: every non-loopback `connect` and
    every name lookup other than `localhost` throws before anything is sent; no test is exempt;
  - a guard test that fails the build if any file under `player/` sets the mix source origin to
    anything but empty, `localhost` or `127.0.0.1`;
  - Swedebeat's and the owner's gateway's known hosts in `scripts/provider-guard.txt` (the list
    only grows), so no tracked file outside `docs/` names them.

  Live checks against a real source are the owner's.

### 3. The encrypted mix cache

Where: `<app data>/mixes/<account key>/`, one folder per classbeat-player account, readable by
that user only, beside the class cache of `main/sync/cache.ts` and wiped with it.

- **Keys.** Each account has a random 256-bit cache key, kept only through `safeStorage`, with
  the lifetime of section 1. From it the player derives a mix tag,
  `HMAC-SHA256(cache key, "cbp-mix-id" || mix id)`, which names the mix on disk instead of its id.
  Each mix file has its own key,
  `HKDF-SHA256(cache key, salt = the file's random 32-byte id, info = "cbp-mix-v1" || mix tag)`,
  so a file is bound to its mix: renamed or copied under another mix's tag, it fails
  authentication on its first chunk. A new download, including a restart, gets a new file id and
  so a new key.
- **Format.** The plaintext is cut into chunks of 256 KiB. Each chunk is sealed with AES-256-GCM
  under the file key, nonce = the chunk index as 96 bits, additional data = file id, mix tag,
  chunk index and a final-chunk flag. A small header file holds, in the clear, only the format
  version, file id, mix tag (never the mix id or title), the source file's identity as
  `describe` gave it (byte length, and the SHA-256 or the source's version when given), chunk
  count when known, and the state (`downloading`, `complete`, `bad`).
- **A nonce is never reused.** Every chunk index is sealed at most once with the same plaintext
  under a file key. A download resumes only when `describe` now answers the same byte length and
  the same SHA-256 or version as the header recorded; if the source gave neither, or anything
  differs, the file is deleted and the download starts over with a new file id. Before resuming,
  the file is truncated to the end of the last whole sealed chunk, so a torn chunk is dropped
  and its index is sealed again only from the same source file at the same offset.
- **No plaintext on disk.** Decrypted audio exists only in the main process's memory, at most a
  few chunks at a time, while the `cbp-mix:` handler (section 5) serves it to the room window,
  whose media pipeline then holds the decoded audio in memory as any played file. The player
  writes no plaintext to a file, a temporary file or a cache; the default session keeps no HTTP
  cache for `cbp-mix:` answers (they carry `Cache-Control: no-store`). A test downloads a fake
  mix with a known byte pattern, plays it, and scans the app data folder for any 64-byte run of
  it.
- **Integrity.** Every chunk read is authenticated; a failed tag, a missing chunk or a final flag
  in the wrong place marks the file `bad`, deletes it, and that play falls back (section 4). At
  completion the player checks the byte length against `describe`, and the SHA-256 when the
  source gave one; a mismatch marks the file `bad`. Before playing, the player compares the
  duration it decodes with the class's `music.swedebeat_mix.length_ms` (section 4): more than
  1 000 ms apart and the mix is not used for that class.
- **Play while downloading.** Playback may start before the file is complete. The download
  writes sealed chunks in order; a read for a chunk not yet written waits for it, for at most
  10 s, then the play falls back as in section 4 while the download carries on.
- **Per account.** A mix is cached and played only under the account whose class names it, and
  played only while that account holds a Swedebeat token (section 1). A cached mix plays offline.
  Two accounts on one studio computer each download their own copy, under their own keys.
- **Eviction.** A mix is deleted when no class of its account names it any more. The cache has a
  size cap, a setting with a default of 4 GiB per account; above it, the mixes played least
  recently are deleted first, never one that is playing or belongs to a class starting within
  the next 24 hours by the class list's order. A mix not played for 90 days is deleted.
- **Downloads** start when a class that names a mix is synced to a signed-in account, or when the
  user opens it, one at a time per account, resumable as above, in the main process only.

### 4. The class format marks a class designed with a Swedebeat mix

A contract pull request adds, as format minor `"1.3"` under ADR 0003 section 7:

| Field | Meaning |
|---|---|
| `music.swedebeat_mix` | Optional. `{ "id": string, "length_ms": int, "offset_ms": int }`: the one mix the class was designed against. `id` is the provider's id, opaque, 1 to 64 characters of `[A-Za-z0-9_-]`, never a token or a link. (As built: the class schema's `swedebeatMix.id` is `^[A-Za-z0-9_-]+$`, 1 to 64, with no newline; the player's own reader, `MIX_ID` in `core/mix/class-mix.ts`, accepts exactly that alphabet and length, so a dotted, empty or 65-character id is refused.) `length_ms` (1 or more) is the mix's length as the source measured it. `offset_ms` (0 or more, default 0) is the mix position at class time 0 |

The validator adds:

- `music.swedebeat_mix` is present only when `music.source` is `swedebeat`;
- `offset_ms + class.length_ms <= length_ms`;
- when songs are present, for every song `0 <= start_ms` and `offset_ms + end_ms <= length_ms`
  (each song's window, read as the mix span `[offset_ms + start_ms, offset_ms + end_ms)`, lies
  inside the mix). The existing checks of ADR 0003 section 4 (contiguous windows, a window never
  longer than its song) still apply.

`songs[].ids.swedebeat_mix` stays as it is. classbeat writes the new field on its side (its own
repository, PL3's converter), and the reference converter here gains a fixture for it.

**What it selects.** The choice is one pure module, `core/mix/mode-policy.ts`:

1. `music.source` is `swedebeat`, `music.swedebeat_mix` is present, the mix source is not
   `UnavailableMixSource`, the account holds a Swedebeat token, and the mix is cached or can be
   read: **mix playback**. The player plays the mix itself and the class clock is driven by the
   audio position, `class time = position - offset_ms`. Interval timing and beat effects are
   exact (the two accuracy targets of ADR 0001 are met by construction and checked on the fake).
2. Otherwise, or when mix playback falls back: **the manual clock**, with a plain reason on
   screen ("Swedebeat is not connected", "The mix is still downloading", "The mix could not be
   checked", "Swedebeat playback is off"). The instructor plays the mix from Swedebeat's own app
   and starts the player with it, as today.

A Swedebeat class never uses the Spotify music link, and a Spotify or soundless class never
uses mix playback. Mix playback is a new `MusicLink` kind, `mix`, whose readings are always
fresh while the audio plays; pause, seek and stop from the player's own controls act on the audio
and the class together. A fall back during play keeps the class clock where it is and continues
on the manual clock, announced on screen; the audio stops rather than play out of step.

### 5. How the audio reaches the speaker

- **The scheme.** The main process registers one scheme, `cbp-mix:`, as standard, secure and
  supporting fetch and streaming, **without `bypassCSP`**, and answers it with `protocol.handle`.
- **One play, one URL.** When the room window starts a mix, the main process issues a play id,
  128 random bits, bound to that window's `webContents` id, the account and the mix tag, and
  sends the room window `cbp-mix://play/<play id>`. The handler answers only a live play id, with
  byte-range support, decrypting chunks in memory (section 3), and answers nothing else: never a
  token, a path, a mix id or a source URL. The play id ends when the play stops, the class
  changes, the room window closes or the account signs out.
- **The request filter.** `hardenSession` (`main/hardening.ts`) cancels every request that
  `isAllowedRequest` (`main/web-preferences.ts`) does not admit. It changes to an allowlist of
  two cases: the application's own files, as today, for every window; and a `cbp-mix:` URL only
  when `details.webContentsId` is the room window's id (`roomId` of `core/ipc-policy.ts`) and the
  play id is live and bound to that window. Every other `cbp-mix:` request, and every other
  scheme, is cancelled.
- **The page.** The room window plays it with one `<audio>` element created by the shell's room
  code (`player/app/src/renderer/`), never by `player/scene/`; the scene gets the clock, not the
  audio. The room page's Content-Security-Policy changes from `media-src 'none'` to
  `media-src cbp-mix:` and nothing else; every other window keeps `media-src 'none'`, and
  `connect-src` stays `'none'` everywhere. The renderer gets no file system, network or keychain
  access for this.
- **Pinned by tests.** The hardening tests pin, as allowlists: the scheme's privileges (no
  `bypassCSP`), the request filter's two cases (a `cbp-mix:` request from any other window, with
  an unknown or ended play id, or after sign-out, is cancelled), and each page's CSP.

### 6. Spotify is unchanged

Spotify audio is never downloaded, stored or played (plan section 3, rule 3; ADR 0004). The
`MixSource` takes only a `swedebeat_mix` id from a class whose `music.source` is `swedebeat`; the
types give it no Spotify id and the mode policy refuses any other source. The provider guard
(`scripts/provider-guard.txt`) is not loosened, and a player-lane test pins that nothing outside
`core/mix/` and `main/mix/` uses the cache or the `cbp-mix:` scheme.

### 7. The PL11 issues

| # | Lane | Issue | Security-critical | Depends on |
|---|---|---|---|---|
| 1 | docs | Designer spec: "Connect Swedebeat", mix download and ready states, the fall-back reasons | No; design review | This ADR |
| 2 | contract | `music.swedebeat_mix`, format minor 1.3: schema, validator, regenerated types, examples, converter fixture | No; rule-sensitive (music) | This ADR |
| 3 | player | `MixSource` interface (with `credentialFields`), `FakeMixSource`, `UnavailableMixSource` as default, the source setting (empty), the player's network guard, the no-real-host guard, Swedebeat and gateway hosts in `scripts/provider-guard.txt` (an infra-lane file, so that part may be its own infra pull request), `mode-policy.ts` | No; rule-sensitive (music) | 2 |
| 4 | player | Swedebeat sign-in and sign-out on the class list page, provisional on the fake: `player:mix-sign-in` in `ipc-policy.ts`, input caps, no fields while `off`, the token in the keychain, the key lifetime and deletion order of section 1 | **Yes** (a provider credential and token) | 1, 3 |
| 5 | player | The encrypted mix cache: keys and mix tag, chunked AES-GCM, resume only on the same source file, truncation of a torn chunk, integrity, per-account folders, eviction, the no-plaintext scan | **Yes** (audio cache and its encryption) | 3, 4 |
| 6 | player | Mix playback: the `cbp-mix:` scheme without `bypassCSP`, per-play ids, the request filter's room-window case, the room page's `<audio>` (outside `player/scene/`) and CSP, the hardening tests' allowlists, the `mix` music link, play while downloading, fall back to the manual clock | **Yes** (shell hardening and its bridge) | 1, 5 |
| 7 | player | The real source client, for the source the owner names; the audio bytes come from the provider straight to the device | **Yes** | Owner: decision 11. Not opened until answered |

Issues 4 to 6 have an Opus Developer and an Opus Reviewer; every one of 2 to 6 is rule-sensitive
and its Reviewer lists rule 3 and sections 2 and 5 of ADR 0004. Issues 1 and 6 change what a user
sees and need a design review. PL11 finishes "done on fakes" with issue 7 open.

### 8. What this changes in earlier ADRs

When this ADR is Accepted: ADR 0004 section 5's "the player shows it and does nothing else with
it" holds while the mix source is `UnavailableMixSource`, and mix playback replaces it once a real
source is enabled; ADR 0001's option E is the Swedebeat mode from then on, with the manual clock
as its fall back. ADR 0003 gains minor 1.3 through issue 2.

## Alternatives

- **Get the mix through another cycling product's account.** Rejected by the owner
  (2026-11-26, ADR 0004 section 4).
- **Download through our backend.** Rejected: rule 3 and plan section 4 say the audio goes from
  the provider straight to the device, never through our server.
- **Stream only, no cache.** Loses offline play and exact start in a studio with a weak network;
  the owner asked for download and cache.
- **Whole-file encryption with one tag.** Cannot play while downloading or detect a bad chunk
  before the end. Chunked AEAD can.
- **Decrypt to a temporary file and hand the path to the audio element.** Puts plaintext on
  disk. Rejected for the in-memory scheme of section 5.
- **`MediaSource` with decrypted buffers pushed from the renderer.** Moves keys or plaintext
  handling into the renderer and needs more code there. Rejected for the main-process scheme.
- **Keep the Swedebeat token in the backend.** The backend would then hold a provider credential
  for every user; the device keychain keeps it on the one computer that uses it.

## Consequences

- A Swedebeat class can run with exact timing and no music link, offline once cached, the best
  case of plan section 4, but only after the owner answers decision 11. Until then every build
  behaves as today, and PL11's code is exercised by the fake.
- The player holds a second kind of secret (a provider token) and an encrypted media cache;
  reviews of sign-in, the cache and the shell's scheme are top tier.
- The room window's CSP gains one media scheme and the request filter one window-bound case; the
  hardening tests change from "no media" to exact allowlists.
- A studio computer with two accounts may hold the same mix twice; the size cap bounds it.
- An invalid token leaves encrypted mixes on disk until sign-out or eviction; they cannot play
  without a token, and the size cap and 90-day rule bound them.
- Watch: decoded length against `length_ms` on real files (Swedebeat's listed length can be
  wrong, classbeat's experience); memory use of chunk decryption during play; how the real
  source states validity and expiry, which may change the "plays only while signed in" rule;
  whether the real source gives a SHA-256 or version (without one, an interrupted download
  always starts over).
- Owner questions, for `docs/owner.md` under plan decision 11: which source supplies the audio;
  and whether the owner's Swedebeat gateway has any part in it. This ADR does not accept the
  gateway as a route. If it is proposed, the owner decides with it how the bytes still go from
  the provider straight to the device (rule 3), how a player outside the owner's network reaches
  it, and that it is `https:`.

## Amendment: the mix cache as built (PL11, #710)

Records code already reviewed, as built. It replaces the section 3 text "the file is truncated to
the end of the last whole sealed chunk, so a torn chunk is dropped" and the issue's "a torn chunk
is truncated first".

- **Resume and torn records.** A chunk index is sealed under one file key only from a source that
  states the same length and SHA-256 or version as the header. On resume every whole record is
  authenticated again; a torn record still on disk is overwritten only if the new sealed chunk
  begins with exactly its bytes, otherwise the file is dropped and the download starts over under a
  new file id (at most twice).
- **Header MAC key.** Derived with HKDF with info `cbp-mix-hdr-v1` followed by the mix tag
  (`core/mix/cache-crypto.ts`).
- **`usedAt`** is part of the authenticated header; eviction reads it from there.
- **Stall.** `DOWNLOAD_IDLE_MS` is 60 s; a stream that sends nothing for that long ends the
  download as `interrupted`, which resumes later.
- **Lost key.** `createKey` replaces a key file it cannot read (`vault.ts`), so the old cache can no
  longer be opened and is lost, not leaked.
- **Plaintext scan.** The test looks for the mix's aligned 32-byte blocks in every file under the
  cache folder; any run of 64 or more plaintext bytes contains at least one whole aligned block, so
  it is found.

## Amendment: mix playback as built (PL11, #693)

Records code already reviewed, as built (owner decision by the Orchestrator, 2026-11-25). It
amends section 3 where it says which mixes are kept and how the cap works.

- **Keep covers every mix a synced class names.** The class format has no start time, so "a class
  starting within the next 24 hours" cannot be told; keep is a superset of that rule
  (`SyncService.mixes()`, passed as `keep` in `main/mix/playback-setup.ts`).
- **Keep is soft above the cap.** A download ahead never takes the cache past 4 GiB: a mix that
  would not fit whole is skipped until the next sync (`fit: true`, `main/mix/prefetch.ts`,
  `main/mix/mix-cache.ts`). Over the cap, eviction deletes the unlisted mixes first, then the
  listed ones, each group least recently used first, and never the playing mix or the open
  class's mix (`core/mix/eviction-policy.ts`).
- **A removed class's mix is deleted only when the synced list is complete and authoritative:**
  the last sync finished, no sync runs, no wipe waits, the pairing is the cached account's and
  every held class reads back (`SyncService.named()`, else null and nothing is deleted for not
  being named).
- **`DRIFT_MS` is 30:** the audio position is steered to the class clock only when they differ by
  more than 30 ms (`core/mix/audio-cue.ts`).
- **"Mix not checked" needs two agreeing length reports.** The room reports the decoded length
  again on `durationchange`; the mix is dropped for a wrong length (more than 1 000 ms from
  `length_ms`) only when two reports in a row give the same length, so an early estimate does not
  drop it (`main/mix/mix-player.ts`, `report`).

## Amendment: sign-out ending mark as built (PL11, #709, #723, #728, #731, #734)

Records code already reviewed, as built. It amends the deletion order in section 1 ("One key
lifetime").

- **An "ending" mark goes first.** Sign-out, unpairing and the account's deletion each write an empty
  mark file for the account (`mix-ending-<account key>.bin`, mode 0600, never following a link
  planted in its place) before anything is deleted (`markEnding` in `main/mix/vault.ts`; `forget`
  in `main/mix/service.ts`). The mark is written and flushed, and then its folder is flushed; the
  folder flush is skipped on win32, which cannot open a folder to flush it (#728, #731, #734).
- **If the mark cannot be written or flushed, nothing is deleted.** The sign-out does not finish, the
  view still shows the account connected, and nothing is reported: `forget` runs `markEnding` inside
  `attempt`, which swallows the error, and `endAccount` returns false (`main/mix/service.ts`).
- **A mark this attempt created but could not flush is removed again, and the removal is flushed**
  (the folder flush is skipped on win32), so a power loss right after cannot bring it back (#728,
  #731, #734). The error `markEnding` throws is the original one, also when the flush of the removal fails. A mark
  left by an earlier, unfinished deletion stays (`markEnding` in `main/mix/vault.ts`).
- **The order is then:** the mark, the cache key, the token, the account's mix folder, and the mark
  last (`forget`, `finish` in `main/mix/service.ts`). Each step runs even when one before it failed.
- **The mark is removed only when all three deletions succeeded** (key, token and folder; `finish`).
  Otherwise it stays.
- **While the mark exists the token reads as gone:** `loadToken` returns null for an ending account
  (`main/mix/vault.ts`), so a crash or a failed deletion never leaves an account that looks
  connected.
- **The start-up sweep or the next sign-in finishes the deletion.** `sweep` ends every account other
  than the current one, whether or not it has a mark, and the current one only when it is marked;
  where the current account holds no key, its mixes folder is removed (`sweep`, `main/mix/service.ts`;
  the accounts come from `accounts()`, `main/mix/vault.ts`). `signIn` finishes an unfinished ending first and
  sends nothing while the mark still cannot be removed (`main/mix/service.ts`).
- The sign-in form's three notes for an empty field, details not taken and a call that did not
  finish are in `core/mix/form-note.ts`; their states are in
  [the Swedebeat spec](../design/swedebeat.md).
