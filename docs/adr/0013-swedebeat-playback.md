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
- **Plan decision 11**, open: whether Swedebeat is asked for an agreement and a source of the
  audio, or the audio comes through the user's MOWL account. Until it is answered, "the manual
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
  gateway, whatever its URL. The same discipline applies here.

## Decision

### 1. Sign-in: the password once, on our own page; the token in the keychain

- The player has a "Connect Swedebeat" screen of its own (a local renderer page, not a web page
  from any server). The user types the Swedebeat username and password there. The renderer hands
  them to the main process over one IPC channel, `mix:sign-in`, in one call; the main process
  passes them to the configured `MixSource`'s `signIn` (section 2) and drops them. The password
  is never written to disk, a log, a crash report, a URL, a setting, the class cache, the backend
  or any model, and is never sent back to a renderer. The IPC handler holds it in one local
  variable for the length of the call; the page clears its field on submit, success or failure.
- What comes back is a **Swedebeat token**, opaque to the player. It is kept only through
  `safeStorage` (the operating system's keychain), in a file only that user can read, under the
  classbeat-player account it was connected for. `keychainUsable` decides as for pairing: with no
  usable keychain the screen says so and does not offer sign-in; there is no plain-text fallback.
- The token stays in the main process. No renderer, preload, IPC answer, log line, error text or
  status message carries it, or the source's origin and paths. Renderers see only a state:
  `off`, `signed_out`, `signing_in`, `signed_in`, `refused`, `unavailable`.
- **Sign out of Swedebeat** deletes the token and that account's mixes (section 3). Unpairing the
  device account, or the account's deletion reaching the device, does the same. A source answer
  that the token is no longer valid deletes the token, keeps the mixes unplayable until the user
  signs in again (section 3, "plays only while signed in") and shows "Connect Swedebeat again".
- A user signs in again by typing the password again. There is no "remember me", no refresh
  secret held beyond what the source returns as its one token, and no second copy of the token.

### 2. A `MixSource` interface; the real source is off and owner-gated

All access to Swedebeat goes through one interface in `player/app/src/core/mix/source.ts`
(types only, no I/O):

| Call | What it does |
|---|---|
| `signIn(username, password)` | Returns a token or a typed refusal (`bad_credentials`, `unavailable`, `rate_limited`) |
| `signOut(token)` | Best effort; the local deletion of section 1 happens whatever it answers |
| `describe(token, mixId)` | The mix's byte length, its duration in ms as the source states it, an optional SHA-256 of the file, and whether this account may play it |
| `read(token, mixId, fromByte)` | A byte stream from `fromByte` to the end |

Implementations:

- **`FakeMixSource`** (tests, CI, the screenshot harness and the developer build): serves a
  generated, licence-free test tone file from the test fixtures, scripts every refusal, slow
  and stalled reads, a wrong length and a changed file, and records what it was asked.
- **`UnavailableMixSource`**, the default in every shipped build: `signIn` and `describe` answer
  `unavailable`. With it the Swedebeat mode is the manual clock, exactly as today.
- **The real source is not built in PL11.** Which one it is (the owner's Swedebeat gateway, a
  source Swedebeat provides, or another route the owner sanctions) is plan decision 11's answer.
  When the owner answers, a separate issue adds that client behind this interface, in the main
  process, with its origin a setting that defaults to empty (off), `https:` only, the host pinned
  by the setting and every request built by one module. No credential or key taken from
  Swedebeat's, MOWL's or any other app is ever used (AGENTS.md section 8).
- **Agents never call a real source.** No test, script, fixture, CI job or developer default names
  a real Swedebeat or gateway host. A guard test in the player lane fails the build if any file
  under `player/` sets the mix source origin to anything but empty, `localhost` or `127.0.0.1`
  outside the settings documentation, and the netguard of the player's unit tests stays as it is.
  Live checks against a real source are the owner's.

### 3. The encrypted mix cache

Where: `<app data>/mixes/<account key>/`, one folder per classbeat-player account, readable by
that user only, beside the class cache of `main/sync/cache.ts` and wiped with it.

- **Keys.** Each account has a random 256-bit cache key, created on its first mix, kept only
  through `safeStorage` next to the Swedebeat token, and deleted with it. Each mix file has its
  own key, `HKDF-SHA256(cache key, salt = the file's random 32-byte id, info = "cbp-mix-v1")`. A
  new download, including a restart of a failed one, gets a new file id and so a new key.
- **Format.** The plaintext is cut into chunks of 256 KiB. Each chunk is sealed with AES-256-GCM
  under the file key, nonce = the chunk index as 96 bits, additional data = file id, chunk index,
  and a final-chunk flag. A chunk is written once and never rewritten under the same key; a
  resumed download continues after the last whole sealed chunk. A small header file holds, in
  the clear, only the format version, file id, mix id hash (SHA-256 of account key and mix id,
  never the mix id or title), chunk count when known, byte length, and the state
  (`downloading`, `complete`, `bad`).
- **No plaintext on disk.** Audio exists in plaintext only in memory, one chunk at a time, in the
  main process. Nothing is written through a temporary file, the browser's media cache or a swap
  file we control. A test downloads a fake mix with a known byte pattern and scans the cache
  folder and the app data folder for any 64-byte run of it.
- **Integrity.** Every chunk read is authenticated; a failed tag, a missing chunk or a final flag
  in the wrong place marks the file `bad`, deletes it, and that play falls back (section 5). At
  completion the player checks the byte length against `describe`, and the SHA-256 when the
  source gave one; a mismatch marks the file `bad`. Before playing, the player compares the
  duration it decodes with the class's `music.swedebeat_mix.length_ms` (section 4): more than
  1 000 ms apart and the mix is not used for that class.
- **Play while downloading.** Playback may start before the file is complete. The download
  writes sealed chunks in order; a read for a chunk not yet written waits for it, for at most
  10 s, then the play falls back as in section 5 while the download carries on.
- **Per account.** A mix is cached and played only under the account whose class names it and
  whose Swedebeat token is in the keychain. A cached mix plays offline, but only while that
  account still has a Swedebeat token; signing out of Swedebeat, unpairing or deletion of the
  account deletes its folder and key. Two accounts on one studio computer each download their own
  copy.
- **Eviction.** A mix is deleted when no class of its account names it any more. The cache has a
  size cap, a setting with a default of 4 GiB per account; above it, the mixes played least
  recently are deleted first, never one that is playing or belongs to a class starting within
  the next 24 hours by the class list's order. A mix not played for 90 days is deleted.
- **Downloads** start when a class that names a mix is synced to a signed-in account, or when the
  user opens it, one at a time per account, resumable, in the main process only.

### 4. The class format marks a class designed with a Swedebeat mix

A contract pull request adds, as format minor `"1.3"` under ADR 0003 section 7:

| Field | Meaning |
|---|---|
| `music.swedebeat_mix` | Optional. `{ "id": string, "length_ms": int, "offset_ms": int }`: the one mix the class was designed against. `id` is the provider's id, opaque, 1 to 64 characters of `[A-Za-z0-9_.-]`, never a token or a link. `length_ms` is the mix's length as the source measured it. `offset_ms` (0 or more, default 0) is the mix position at class time 0 |

The validator adds: `music.swedebeat_mix` only when `music.source` is `swedebeat`; `offset_ms +
class.length_ms <= length_ms`; when songs are present, song windows read as mix positions minus
`offset_ms`, so a song's window equals its place in the mix. `songs[].ids.swedebeat_mix` stays as
it is. classbeat writes the field on its side (its own repository, PL3's converter), and the
reference converter here gains a fixture for it.

**What it selects.** The choice is one pure module, `core/mix/mode-policy.ts`:

1. `music.source` is `swedebeat`, `music.swedebeat_mix` is present, the mix source is not
   `UnavailableMixSource`, the account is signed in to Swedebeat, and the mix is cached or can be
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

- The main process registers one privileged scheme, `cbp-mix:`, whose handler answers only the
  room window, only for the mix of the class that window is playing, with byte-range support,
  decrypting chunks in memory (section 3). It answers nothing else and never a token, a path or a
  source URL.
- The room window plays it with one `<audio>` element. Its Content-Security-Policy changes from
  `media-src 'none'` to `media-src cbp-mix:` and nothing else; every other window keeps
  `media-src 'none'`. The hardening tests pin exactly that, as an allowlist.
- The renderer gets no file system, network or keychain access for this; `connect-src` stays
  `'none'` everywhere.

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
| 3 | player | `MixSource` interface, `FakeMixSource`, `UnavailableMixSource` as default, the source setting (empty), the no-real-host guard, `mode-policy.ts` | No; rule-sensitive (music) | 2 |
| 4 | player | Swedebeat sign-in and sign-out: the page, `mix:sign-in`, the token in the keychain, deletion on sign-out, unpair and account deletion | **Yes** (a provider password and token) | 1, 3 |
| 5 | player | The encrypted mix cache: keys, chunked AES-GCM, integrity, per-account folders, eviction, resumable download from the fake, the no-plaintext scan | **Yes** (audio cache and its encryption) | 3, 4 |
| 6 | player | Mix playback: the `cbp-mix:` scheme, the room window's audio and CSP change, the `mix` music link, play while downloading, fall back to the manual clock | **Yes** (shell hardening and its bridge) | 1, 5 |
| 7 | player | The real source client | **Yes** | Owner: decision 11. Not opened until answered |

Issues 4 to 6 have an Opus Developer and an Opus Reviewer; every one of 2 to 6 is rule-sensitive
and its Reviewer lists rule 3 and sections 2 and 5 of ADR 0004. Issues 1 and 6 change what a user
sees and need a design review. PL11 finishes "done on fakes" with issue 7 open.

### 8. What this changes in earlier ADRs

When this ADR is Accepted: ADR 0004 section 5's "the player shows it and does nothing else with
it" holds while the mix source is `UnavailableMixSource`, and mix playback replaces it once a real
source is enabled; ADR 0001's option E is the Swedebeat mode from then on, with the manual clock
as its fall back. ADR 0003 gains minor 1.3 through issue 2.

## Alternatives

- **Get the mix through the user's MOWL account** (the short-lived link MOWL hands out). Makes
  every Swedebeat class depend on MOWL, and is one of decision 11's two routes, so it is the
  owner's. The interface of section 2 admits it as a source if the owner chooses it.
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
- The room window's CSP gains one media scheme; the hardening tests change from "no media" to an
  exact allowlist.
- A studio computer with two accounts may hold the same mix twice; the size cap bounds it.
- Watch: decoded length against `length_ms` on real files (Swedebeat's listed length can be
  wrong, classbeat's experience); memory use of chunk decryption during play; how the real
  source states validity and expiry, which may change the "plays only while signed in" rule.
- Owner items: plan decision 11 (the source of the audio), and, if the source is the owner's
  gateway, how a player outside the owner's network reaches it.
