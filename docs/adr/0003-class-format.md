# 0003. Class format

Status: Accepted when this pull request merges (2026-11-12)

## Context

The player plays classes it did not make. A source (classbeat first) sends each class to the
backend, the backend keeps it in the account's library, and every paired device fetches it and
plays it offline (plan, section 5). The application also opens a class file from disk, which is
how demos, tests and spike 1 run before the backend exists.

The plan fixes what the format is: this project's own, one versioned JSON document per class,
published as a JSON Schema in the repository, with Python and TypeScript types generated from it
and contract tests on both sides. Each document is a complete snapshot with no reference back to
the source. ADR 0001 fixes the timing model that reads it: each song owns a window of class time,
and the class states the crossfade it was designed for.

The screens need, for every moment of a class: the time left in the interval and the class, the
target effort, the target cadence, the BPM, and what comes next (plan, section 2). The product
rules of plan section 3 limit what the format may carry: no games (rule 15 and the "ruled out"
row of section 12), no rider data, colour from the planned zone only (rule 7), and our own names
for load figures (rule 9).

classbeat's own data, read for this ADR only to see which fields exist, has per interval: a
length in whole seconds, a zone (1 to 7 for cycling, 1 to 5 for running), a cadence range or
"ride on the beat", seated or standing, a cue of up to 120 characters, an optional game and an
optional FTP test of 3, 5 or 20 minutes; for running, a treadmill incline of 0 or 1 instead of
cadence and position. Intervals are grouped in named segments of kind warm-up, main, recovery or
cool-down. Nothing of classbeat's code is used here.

## Decision

### 1. One source, generated types

- The schema is JSON Schema draft 2020-12, in the contract lane: `schema/class/v1/class.schema.json`
  for the document and `schema/class/v1/publication.schema.json` for the envelope (section 6).
  Example classes are in `schema/examples/`.
- Types are generated, never written by hand: Python (Pydantic v2) for the backend and
  TypeScript for the player and the screens. The generators are a default of the contract lane
  (datamodel-code-generator and json-schema-to-typescript), pinned in its lockfiles.
- CI regenerates the types and fails if the committed ones differ. The contract pull request that
  changes the schema also commits the regenerated types in the other lanes, and nothing else
  there (AGENTS.md, section 3, rule 1).
- Contract tests on both sides validate every example class against the schema and round-trip it
  through the generated types.

### 2. Units

- **All times are whole milliseconds** (`*_ms`, integers), measured from the start of the class
  or, for points inside a song, from the start of that song. Integers keep sums exact.
- Cadence is in revolutions (or steps) per minute, BPM in beats per minute, both numbers.
- Text is UTF-8. Cues keep the source's limit of 120 characters; names are at most 80.

### 3. The document

Top level:

| Field | Meaning |
|---|---|
| `format_version` | `"MAJOR.MINOR"`, this ADR defines `"1.0"` |
| `class` | `title`, optional `description`, `sport` (`cycling` or `running`), `length_ms` |
| `music` | `source` (`spotify`, `swedebeat` or `none`), `design_crossfade_ms` (the crossfade the class was designed for, 0 or more), `song_timing` (`measured`, `estimated` or `missing`) |
| `zone_scale` | The zones this class uses: per zone its number, name, and optional target ranges (`ftp_pct`, `hrmax_pct`, `rpe`, each `[low, high]`) |
| `totals` | `length_ms`, `time_in_zone_ms` (per zone number), optional `planned_load` |
| `segments` | Optional named spans: `name`, `kind` (`warmup`, `main`, `recovery`, `cooldown`), `start_ms`, `end_ms` |
| `intervals` | The intervals in order (below) |
| `songs` | The songs in order (below); empty when `music.source` is `none` |

The zone scale travels with the class so the player never hard-codes a zone table and every
zone can be shown as a number and a name as well as a colour. The colour is the player's, chosen
from the zone number (rule 7); the format carries no colour.

`planned_load` is a number under this product's own name, which the design work chooses (rule 9).
The field name is neutral on purpose. Its definition is the source's, stated in the source's
documentation; the player only shows it.

Each **interval**:

| Field | Meaning |
|---|---|
| `start_ms`, `length_ms` | Absolute start in class time and length |
| `zone` | A zone number from `zone_scale` |
| `cadence` | Cycling: `{ "from": n, "to": n }`, or `"beat"` (ride on the beat of the song under it). Absent for running |
| `position` | Cycling: `seated` or `standing` |
| `incline` | Running: `flat` or `raised`. A target shown as text, never sent to equipment (rule 2) and never drawn as a slope (rule 4) |
| `cue` | The cue text written when the class was designed, possibly empty (rule 10) |
| `test` | Optional: `{ "kind": "ftp", "minutes": 3 | 5 | 20 }`, a test interval to label as such |

A source's games are not part of the format. A converter drops them; the schema has no field for
them.

Each **song**:

| Field | Meaning |
|---|---|
| `title`, `artist`, `length_ms` | As the source has them |
| `start_ms`, `end_ms` | The song's window in class time (ADR 0001): `end_ms` is the next song's `start_ms`, or the class end for the last song |
| `bpm` | The song's tempo, optional when unknown |
| `ids` | Optional provider ids: `spotify_track` (the track id, never a token), `isrc`, `swedebeat_mix` |
| `beat_anchors` | `{ "quality": "measured" | "estimated" | "missing", "anchors": [ { "at_ms": n, "bpm": n } ] }`: points in the song where a bar starts, each with its tempo, including any correction the instructor applied at the source |
| `moments` | `{ "quality": ..., "items": [ { "at_ms": n, "kind": "drop" | "breakdown" | "build" | "other" } ] }`, for effects only |

`at_ms` inside a song is measured from the song's own start, so an anchor does not move when the
song's window moves.

### 4. What the document must satisfy

The schema checks the shapes. A validator in the contract lane, used by the backend on every
publication and by the player on every file it opens, checks what a schema cannot:

- Intervals start at 0, follow each other without gaps or overlaps, and end at `class.length_ms`.
- Songs, when present, are in order with contiguous windows: each `end_ms` is the next
  `start_ms`; a window is never longer than its song (`end_ms - start_ms <= length_ms`).
- Segments, when present, cover whole intervals.
- Every interval's zone exists in `zone_scale`; `totals` agree with the intervals.
- Cycling intervals have `cadence` and `position` and no `incline`; running intervals the
  reverse.
- Anchors and moments lie inside their song.

### 5. When music detail is missing

As the plan states: no anchors means the scene pulses at the tempo only; no moments means bursts
follow interval changes; `song_timing: missing` means the player offers the manual clock only.
Whether an older class is refitted or sent as manual-clock only is the source's decision (PL3).

### 6. The publication envelope

What a source sends to the backend (the source API of plan section 5; tokens and the API itself
are ADR 0002's and PL2's):

| Field | Meaning |
|---|---|
| `source_class_id` | The source's own id for the class, a string of at most 100 characters |
| `publication_number` | A positive integer the source increases every time it sends that class |
| `removed` | `true` for a removal, which carries no document |
| `content_hash` | `"sha256:"` and the lowercase hex SHA-256 of the document in RFC 8785 (JSON Canonicalization Scheme) form; absent for a removal |
| `document` | The class document; absent for a removal |

The same number with the same hash is a repeat, accepted with no change; a lower number is
refused as stale; a removal is a publication with its own number and leaves a marker with no
titles in it (plan, section 5). The backend recomputes the hash and refuses a mismatch.

### 7. Versions

- `MAJOR.MINOR`. A minor version only adds optional fields. A major version is anything else.
- Producers validate strictly against the exact version they write: unknown fields are refused.
- Readers accept any minor of a major they know and ignore fields they do not know.
- The player refuses an unknown major with a plain message ("This class needs a newer version of
  the player") and keeps playing its other classes.
- The backend accepts the majors it knows. When a new major arrives, the backend converts stored
  classes of the previous major when it serves them, so devices see one major; the player API's
  version check then makes each device resync in full (plan, section 5). Default: one previous
  major is kept convertible; older ones are converted once, in a migration.

### 8. The converter boundary

classbeat converts its own data into this format on its side (PL3); this repository never reads
classbeat's code or database. PL1 adds a reference converter, in the contract lane, used only by
tests: it maps a hand-written fixture in classbeat's data shape (the fields listed in Context) to
a class document and checks the result against the schema and the validator. It shows the
mapping (whole seconds to milliseconds, games dropped, incline 0 or 1 to `flat` or `raised`) and
is what PL3 ports, not a dependency.

## Alternatives

- **Reuse classbeat's or MOWL's shape.** Ties the player to another product's changes and carries
  fields the rules exclude (games). Rejected; the plan makes the format this project's own.
- **Seconds as decimals.** Simpler to read, but sums drift. Rejected for integer milliseconds.
- **Song windows derived by the player from lengths and the crossfade.** Would hide the source's
  intent and break when a source trims a song. Rejected: windows are explicit and the crossfade
  is stated beside them.
- **A colour per zone in the document.** Would let a source paint the screen. Rejected: colour is
  the player's, from the zone number.
- **Protocol Buffers or another binary format.** Smaller, but harder to read in a file opened
  from disk and to review. Rejected; the size of one class does not need it.

## Consequences

- Every screen value has a source: time left from the interval and song windows and the class
  length, target effort from the zone and its scale, cadence from the interval, BPM from the song
  and its anchors, what comes next from the following interval, its cue and the next song.
- The format carries no rider data and no colour, which keeps rules 7, 13 and 15 out of reach of
  a source.
- A schema change is always a contract pull request first, with regenerated types, before any
  lane builds on it.
- The validator is pure (CLAUDE.md, code structure rule 2) and shared by backend and player as
  generated or ported code; PL1 decides which, behind the contract tests.
- Song titles and artists are kept only while the class exists (plan, section 5); the removal
  marker carries none.
