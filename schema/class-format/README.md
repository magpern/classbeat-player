# Class format v1

The schema and validators of [ADR 0003](../../docs/adr/0003-class-format.md). This file records
the choices the ADR left open (the review notes carried into PL1) and maps every ADR rule to
where it is enforced and which vector tests it. The ADR itself is unchanged.

## Layout

| Path | What |
|---|---|
| `class-format/v1/class.schema.json` | The class document (JSON Schema 2020-12), strict |
| `class-format/v1/publication.schema.json` | The publication envelope; `document` refers to the class schema |
| `class-format/v1/examples/` | Shared test vectors, read by both test suites (see below) |
| `python/src/classformat/` | `semantic.py` (rules a schema cannot state), `sequence.py` (publication sequencing), `hashing.py` (RFC 8785 + SHA-256), `check.py` (schema + semantics, strict or reader). All pure |
| `ts/src/` | The same four modules in TypeScript, same names, same results |
| `generated/python/`, `generated/ts/` | Pydantic v2 and TypeScript types, never edited by hand |
| `generate.sh`, `check-generated.sh`, `ci.sh` | Regenerate, fail when stale, run everything (the infra lane's job only calls `ci.sh`) |

The ADR names the paths `schema/class/v1/` and `schema/examples/`; issue #20 says
`schema/class-format/v1/` and `.../examples/`, and this follows the issue.

Pure modules import no I/O: `semantic`, `sequence` and `hashing` use only the standard library
and `rfc8785`/`canonicalize`; `check` additionally uses the JSON Schema library and takes the
schema as an argument. Tests (and the player or backend, later) load the files.

Pinned tools: `datamodel-code-generator` 0.53.0 (Python), `json-schema-to-typescript` 15.0.4,
`ajv` 8.17.1, `canonicalize` 2.1.0, `typescript` 5.9.3; the rest in `python/uv.lock` and
`ts/package-lock.json`. The TypeScript side runs `.ts` files directly through Node's type
stripping (no build step), so `engines.node` is `>=22.18`; CI uses Node 24.

## Vectors

```
examples/valid/                  strict-valid documents (also valid for readers)
examples/invalid/<rule>.json     one broken rule each; expected.json says which code and where
examples/reader/                 reader-mode vectors (future minor accepted, unknown major refused)
examples/publications/valid|invalid/
examples/warnings.json           expected warnings per valid vector (none listed means none)
examples/sequences.json          publication sequencing table
```

Both suites check: every valid vector passes; every invalid vector fails with the expected
`(code, JSON pointer)` pairs. Semantic failures are compared exactly, in both languages. A
schema failure has the code `schema` and the test checks that an error is reported at the
expected pointer (the two JSON Schema libraries word their errors differently, but both report
the place). A document only reaches the semantic rules if it passed the schema.

The valid vectors are hand-maintained. Changing a valid document means recomputing the
`content_hash` in `publications/valid/document.json` (a `hash_mismatch` test failure says so).

## Choices for the carried review notes

1. **Same publication number, different hash: refused as a `conflict`.** The same number with
   the same hash is a `repeat` (accepted, no change). Also a conflict at the same number: a
   removal against a document, either way. Two removals with the same number are a repeat.
2. **A higher number after a removal is accepted.** This is the one place the choice is not the
   strictest: refusing would make a removed `source_class_id` unusable for ever, and numbers
   already keep every older publication (including the old document) out, because a lower
   number is `stale`. So a source may publish a class again under a higher number, and the
   document replaces the removal marker. Flagged for the reviewer.
3. **First song starts at 0, last song ends at the class length.** Both enforced
   (`songs_first_start_not_zero`, `songs_last_end_mismatch`). Windows must also be non-empty
   (`song_window_empty`).
4. **`song_timing: missing`.** Song windows stay required fields and are validated like any
   others; `song_timing` states how far they can be trusted. With `missing` the player uses the
   manual clock only and ignores the windows (ADR 0003 section 5). Titles and artists can
   therefore still be shown. Music source `none` requires `songs` empty and
   `song_timing: missing`; any other source requires at least one song. Anchors or moments of
   quality `missing` must be empty lists; of any other quality, non-empty.
5. **Producers strict, readers lax.** One schema file, strict (`additionalProperties: false`
   everywhere, `format_version` `"1.0"`, `"1.1"` or `"1.2"`, the minors this schema knows). The reader schema is derived from it in code
   (`reader_schema`): unknown fields allowed, any `1.x` accepted. A reader first checks the
   version string: an unknown major gives `unsupported_major` (the plain "needs a newer version"
   message is the player's), a malformed string a `schema` error. Everything else (types,
   ranges, conditionals, semantic rules) applies to readers unchanged. Both modes exist in
   Python and TypeScript.
6. **Which hash identifies a class after a major conversion: the hash the source sent.** The
   backend keeps the source's `content_hash` with `(source_class_id, publication_number)` for
   sequencing and never recomputes it on a converted document. A converted copy is not
   hash-addressed; it is regenerated from the stored original when a device asks. Hash checks
   happen only on receipt, over the document exactly as received (including, for readers,
   fields this version does not know).
7. **`time_in_zone_ms` keys are the zone numbers as decimal strings** (`"1"` to `"7"`,
   JSON objects have string keys); values are integers of at least 0. The keys must be exactly
   the zones of `zone_scale`, zero-time zones included (`totals_zone_keys_mismatch`).

Other choices where the ADR is silent (strictest safe reading unless noted):

- Zones are integers 1 to 7; a running class may use only 1 to 5 (`zone_out_of_range_for_sport`).
  Zone numbers in `zone_scale` are unique; target ranges and cadence ranges are `[low, high]`
  with low at most high (`range_inverted`).
- Segments need not tile the class (gaps allowed), but must be ordered, not overlap, and start
  and end on interval boundaries.
- Anchors and moments are strictly increasing in `at_ms` and lie in `[0, song.length_ms)`,
  measured against the song's own length, not its window.
- Intervals need `length_ms` at least 1; the class is at most 24 hours; crossfade at most 30 s;
  cues at most 120 characters, names (class, zone, segment) at most 80, song title and artist at
  most 200, description at most 2000; BPM 30 to 300; cadence 1 to 300 or `"beat"`.
- Running intervals may not carry an FTP `test` (FTP is a cycling test).
- `spotify_track` must look like a track id (22 letters and digits), so a token cannot be put
  there by mistake.
- `removed: false` is allowed and means an ordinary publication; a removal carries neither
  `document` nor `content_hash`, and anything else carries both.
- The reference converter of ADR 0003 section 8 is in `schema/converter/` (issue #26).
- The generated types cannot state the conditional rules (`if`/`then`); the TypeScript `Class`
  type is an intersection with an index signature because of the top-level `allOf`. The
  validators, not the types, are the contract.

## Format 1.1: beat-counted position patterns (issue #469)

Minor 1.1 is additive: it adds one optional field, `interval.pattern`, and nothing else. Every
1.0 document is a valid 1.1 document and is unchanged (the 1.0 vectors are untouched). A 1.0
reader accepts a 1.1 document by the reader rules (a newer minor with unknown fields) and
ignores `pattern`; it still finds `position` on every cycling interval, which is why `position`
stays required (choice 2).

```json
"pattern": { "kind": "alternate", "positions": ["seated", "standing"], "beats": [8, 8], "start_on": "next_downbeat" }
```

`positions` and `beats` have 2 to 4 entries; each `beats` value is an integer from 1 to 64,
counted on the song's beat. The beat comes from `bpm` and `beat_anchors` when present;
otherwise the player counts time from `bpm` alone. `start_on` is optional:
`interval_start` (the default) or `next_downbeat`. The pattern repeats until the interval
ends. A climb inside a song needs no new field (intervals sit on the class timeline, not on
songs); `valid/class-pattern-climb-and-jumps.json` shows three intervals inside one song plus
an 8 up, 8 down jumps interval.

Choices the issue left open:

1. **Strict producers must write `"1.1"` to use a pattern.** The strict schema accepts
   `format_version` `"1.0"` or `"1.1"`; a document labelled `"1.0"` that carries a `pattern`
   is a schema error in both modes (`schema-pattern-in-format-1-0`), because 1.0 has no such
   field. A later minor (1.2 and up) in reader mode may carry it.
2. **`position` stays required and the pattern wins.** The issue allowed "both is an error, or
   one wins". Making them exclusive would drop `position` from patterned intervals, and a 1.0
   reader would then refuse the document for a missing required field, breaking additivity. So
   a cycling interval with a pattern still carries `position`, and it must equal
   `positions[0]` (the position the interval starts in): `pattern_position_mismatch` at
   `/intervals/<i>/position`. For a reader that understands 1.1 the pattern decides what the
   rider does after the start; `position` is the fallback for older readers.
3. **Lists of different length: error `pattern_length_mismatch`** at
   `/intervals/<i>/pattern/beats` (JSON Schema cannot compare two arrays). Length 2 to 4 and
   the 1 to 64 beat range are schema errors.
4. **Cycling only.** A running interval carrying a `pattern` is a schema error, like `position`.
5. **A song without `bpm` is a warning, not an error: `pattern_without_bpm`** at
   `/intervals/<i>/pattern`. Why a warning: the document still describes the class correctly;
   the player merely cannot count beats there (it falls back to the time the interval gives).
   It is raised when any song window overlapping the interval has no `bpm`, or no song
   overlaps it (music source `none`). `beat_anchors` alone do not count as a `bpm`. Warnings
   come only from `check_warnings` (Python) / `checkWarnings` (TypeScript); `check_document`
   never returns them, so a document with warnings is valid in strict and reader mode. The
   expected warnings of each valid vector are in `examples/warnings.json`.
6. **No cross-check of beats against the interval length.** An interval shorter than one full
   cycle, or one that ends mid-cycle, is valid: the player cuts the pattern at the interval end.
7. **Generated types.** `format_version` is a schema `$defs` entry (`formatVersion`) because a
   two-valued enum written inline in the class schema stops the Pydantic generator from
   emitting the publication module. The types in `generated/` carry the new field; the player
   and screens code reads them unchanged (rendering the beat count is a follow-up issue).

New vectors: `valid/class-pattern-climb-and-jumps.json`, `valid/class-pattern-song-without-bpm.json`
(warning), `reader/accepted-pattern-in-future-minor.json`, and the `invalid/*pattern*` files
(bad lengths, beat counts of 0, 65 and 7.5, unknown kind, `start_on` and position, one and
five positions, `position` differing from `positions[0]`, a 1.0 label, a running interval).

## Format 1.2: Spotify playlist id (issue #464, contract part)

Minor 1.2 is additive, by ADR 0003 section 7 ("a minor version only adds optional fields"): it
adds one optional field, `music.spotify_playlist`, and nothing else. It is a new minor, not an
addition to 1.1, because strict producers validate against the exact version they write and 1.1
has no such field; this follows the 1.1 precedent. Every 1.0 and 1.1 document is a valid 1.2
document and is unchanged. A 1.0 or 1.1 reader accepts a 1.2 document by the reader rules and
ignores the field.

```json
"music": { "source": "spotify", "design_crossfade_ms": 0, "song_timing": "estimated", "spotify_playlist": "37i9dQZF1DXcBWIGoYBM5M" }
```

1. **Same pattern as `ids.spotify_track`, plus an exact length:** exactly 22 letters or digits (`^[A-Za-z0-9]{22}$`, `minLength` and `maxLength` 22, because Python's `$` also matches before a final newline and Ajv's does not),
   the bare id, never a URL or a `spotify:` URI. A malformed id is a schema error at
   `/music/spotify_playlist`.
2. **Strict producers must write `"1.2"` to use it.** A document labelled `"1.0"` or `"1.1"`
   that carries the field is a schema error in both modes (pointer `/music`).
3. **Only with source `spotify`:** semantic rule `playlist_without_spotify_source` at
   `/music/spotify_playlist` (a playlist id beside source `none` or `swedebeat` is meaningless).
4. **Data only.** The field names a playlist; this contract does not say what a player does
   with it. Spotify audio is never downloaded, stored or played by this product.

Vectors: `valid/class-spotify-playlist.json`, `invalid/schema-spotify-playlist-malformed`,
`invalid/schema-spotify-playlist-in-format-1-0`, `invalid/schema-spotify-playlist-in-format-1-1`,
`invalid/playlist-without-spotify-source`; the strict future-minor vector is now
`schema-strict-refuses-minor-1-4` (it was 1.3 until minor 1.3 existed). The reference converter writes the field (format 1.2) when
the fixture has a playlist id (`converter/fixtures/class-30min-spotify-playlist.*`).

## Format 1.3: Swedebeat mix (issue #689, contract part; ADR 0013 section 4)

Minor 1.3 is additive (ADR 0003 section 7): it adds one optional field, `music.swedebeat_mix`,
and nothing else. Every 1.0 to 1.2 document is a valid 1.3 document and is unchanged; an older
reader accepts a 1.3 document by the reader rules and ignores the field.

```json
"music": { "source": "swedebeat", "design_crossfade_ms": 9000, "song_timing": "estimated",
           "swedebeat_mix": { "id": "mix_2024-11-01-Ride_45", "length_ms": 3000000, "offset_ms": 120000 } }
```

1. **Fields.** `id`: 1 to 64 characters of `[A-Za-z0-9_-]`, opaque, never a token or a link (a
   URL, a space or a trailing newline is a schema error at `/music/swedebeat_mix/id`). `length_ms`:
   whole milliseconds, 1 or more, required. `offset_ms`: whole milliseconds, 0 or more, default 0
   (the mix position at class time 0). No other field.
2. **Id alphabet, from evidence.** The pattern is classbeat's own `MIX_ID`
   (`^[0-9A-Za-z_-]{1,64}$`, `backend/src/classbeat/operations/swedebeat.py`, also its
   `classes/duplicate_music.py`). ADR 0013 section 4 also lists `.`; classbeat never accepts it
   (an id with a dot is dropped from its mix listing), so the contract is the narrower set. A
   class classbeat writes therefore always validates. Widening later is a new minor.
3. **Strict producers must write `"1.3"` to use it.** A `"1.0"`, `"1.1"` or `"1.2"` label that
   carries the field is a schema error in both modes (pointer `/music`).
4. **Only with source `swedebeat`:** semantic rule `swedebeat_mix_without_swedebeat_source` at
   `/music/swedebeat_mix` (no other mix rule is reported for such a document).
5. **The mix covers the class:** `swedebeat_mix_too_short` at `/music/swedebeat_mix/length_ms` when
   `offset_ms + class.length_ms > length_ms`; `song_outside_mix` at `/songs/<i>/end_ms` when
   `offset_ms + end_ms > length_ms`. (The last window ends at the class length, so
   `song_outside_mix` only fires together with `swedebeat_mix_too_short`; it is kept because
   ADR 0013 names it.)
6. **Data only.** `songs[].ids.swedebeat_mix` is unchanged. The field names a mix; the player
   decides what to do with it (ADR 0013).

Vectors: `valid/class-swedebeat-mix`, `valid/class-swedebeat-mix-no-offset-exact-fit`,
`invalid/schema-swedebeat-mix-*` (labels 1.0 and 1.2, length 0, offset negative or fractional,
id empty, 65 characters, URL, trailing newline, missing length, unknown field),
`invalid/swedebeat-mix-with-spotify-source`, `-with-source-none`, `-too-short-for-class`,
`-offset-pushes-past-end`. The reference converter writes the field (format 1.3) for
`converter/fixtures/class-30min-swedebeat-mix.*`.

## Where each ADR rule is enforced

`S` = JSON Schema, `V` = semantic validator (`semantic.py` / `semantic.ts`), `P` = publication
check or `sequence`. Vector names are files in `examples/invalid/` unless a folder is named.

| ADR 0003 rule | Where | Vector that tests it |
|---|---|---|
| s1 JSON Schema 2020-12, class and publication files | S | every vector |
| s1 types generated; stale types fail CI | `generate.sh`, `check-generated.sh` | edit-without-regenerating check; `tests/test_generated.py`, `test/generated-types.test.ts` (round trip) |
| s2 times are whole milliseconds | S (`integer`) | `schema-time-not-integer` |
| s2 cue at most 120 characters, names at most 80 | S | `schema-cue-over-120-chars`, `schema-title-over-80-chars` |
| s3 `format_version` `"1.0"` to `"1.3"` | S (strict), reader pattern | `schema-strict-refuses-minor-1-4`, `reader/` |
| s3 required top-level fields, no unknown fields (no games, no colour) | S | `schema-missing-required-music`, `schema-unknown-field-games`, `schema-unknown-nested-field-colour` |
| s3 sport, music source, `design_crossfade_ms` at least 0, `song_timing` values | S | `schema-sport-unknown`, `schema-source-none-timing-not-missing` |
| s3 zone scale: unique numbers, ranges | S, V | `zone-scale-duplicate`, `zone-scale-range-inverted`, `schema-zone-out-of-1-to-7` |
| s3 `totals.time_in_zone_ms` per zone number | S, V | `schema-time-in-zone-key-not-zone-number`, `schema-time-in-zone-value-negative`, `totals-zone-key-missing` |
| s3 intervals: fields, cadence range or `beat`, position, incline, cue, FTP test 3/5/20 | S | `schema-cadence-bad-word`, `schema-ftp-test-minutes-not-3-5-20` |
| s3 song fields, ids, anchors, moments and their qualities | S | `schema-anchors-quality-missing-but-listed`, `schema-moments-quality-measured-but-empty`, `schema-moment-kind-unknown`, `schema-spotify-id-is-not-a-track-id`, `schema-song-bpm-out-of-range` |
| s3 `songs` empty when source is `none` | S | `schema-source-none-with-songs`, `schema-source-spotify-without-songs` |
| s4 intervals start at 0, no gaps or overlaps, end at class length | V | `intervals-start-not-zero`, `intervals-gap`, `intervals-overlap`, `intervals-end-before-class-length` |
| s4 song windows contiguous, window at most song length | V | `songs-window-gap`, `songs-window-overlap`, `songs-window-longer-than-song`, `songs-window-empty` |
| s4 (carried) first song at 0, last song ends at class length | V | `songs-first-start-not-zero`, `songs-last-end-not-class-end` |
| s4 segments cover whole intervals | V | `segment-not-on-interval-boundary` (start), `segment-end-not-on-interval-boundary` (end), `segments-overlap`, `segment-empty` |
| s4 every interval zone exists in the scale | V | `zone-not-in-scale` |
| s4 totals agree with intervals | V | `totals-length-mismatch`, `totals-zone-time-mismatch`, `totals-zone-key-missing` |
| s4 cycling: cadence and position, no incline; running the reverse | S | `schema-cycling-interval-missing-cadence`, `...-missing-position`, `...-has-incline`, `schema-running-interval-has-cadence`, `schema-running-interval-missing-incline` |
| s4 anchors and moments inside their song | V | `anchor-outside-song`, `moment-outside-song`, `anchors-unordered`, `moments-unordered` |
| s5 missing music detail (no anchors, no moments, `missing` timing) | S (qualities), player behaviour | `valid/class-song-timing-missing`, `valid/class-beat-anchors-and-moments` |
| s6 envelope fields, hash format, removal carries no document | S | `publications/invalid/*` (`removal-carries-document`, `hash-missing-prefix`, `number-zero`, ...) |
| s6 hash is SHA-256 over RFC 8785 form; mismatch refused | P (`check_publication`) | `publications/invalid/hash-mismatch`, `valid/document`, known-digest test |
| 1.2 `music.spotify_playlist`: 22-character id, no URI, URL or newline | S | `schema-spotify-playlist-malformed`, `-uri`, `-url`, `-21-chars`, `-23-chars`, `-trailing-newline`, `-colons-22`, `-quote-22`, `-space-22` (exactly 22 characters, not all letters or digits) |
| 1.2 playlist only with a 1.2 label | S (strict and reader) | `schema-spotify-playlist-in-format-1-0`, `-1-1`; `test_playlist_document_is_1_2_and_older_labels_are_refused` |
| 1.2 playlist only with source `spotify` | V (`playlist_without_spotify_source`) | `playlist-without-spotify-source`, `playlist-with-swedebeat-source` |
| 1.3 `music.swedebeat_mix`: id, bounds, label, source, covers class | S, V | see "Format 1.3" above; `test_swedebeat_mix_*` |
| s6 repeat, stale, removal marker (and the carried cases) | P (`sequence`) | `sequences.json` |
| s7 producers strict, readers lax, any minor of a known major | `check` modes | `reader/accepted-future-minor-unknown-fields`, `test_producer_is_strict_where_reader_is_lax` |
| s7 unknown major refused | `check` reader mode | `reader/rejected-unknown-major` |
| s7 backend conversion of the previous major | not in PL1 (no second major yet); see choice 6 | none |
| s8 reference converter | `schema/converter/` | `converter/test_converter.py`, `ts/test/converter-fixtures.test.ts` |
