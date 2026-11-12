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
   everywhere, `format_version` exactly `"1.0"`). The reader schema is derived from it in code
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

## Where each ADR rule is enforced

`S` = JSON Schema, `V` = semantic validator (`semantic.py` / `semantic.ts`), `P` = publication
check or `sequence`. Vector names are files in `examples/invalid/` unless a folder is named.

| ADR 0003 rule | Where | Vector that tests it |
|---|---|---|
| s1 JSON Schema 2020-12, class and publication files | S | every vector |
| s1 types generated; stale types fail CI | `generate.sh`, `check-generated.sh` | edit-without-regenerating check; `tests/test_generated.py`, `test/generated-types.test.ts` (round trip) |
| s2 times are whole milliseconds | S (`integer`) | `schema-time-not-integer` |
| s2 cue at most 120 characters, names at most 80 | S | `schema-cue-over-120-chars`, `schema-title-over-80-chars` |
| s3 `format_version` `"1.0"` | S (strict), reader pattern | `schema-strict-refuses-minor-1-1`, `reader/` |
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
| s6 repeat, stale, removal marker (and the carried cases) | P (`sequence`) | `sequences.json` |
| s7 producers strict, readers lax, any minor of a known major | `check` modes | `reader/accepted-future-minor-unknown-fields`, `test_producer_is_strict_where_reader_is_lax` |
| s7 unknown major refused | `check` reader mode | `reader/rejected-unknown-major` |
| s7 backend conversion of the previous major | not in PL1 (no second major yet); see choice 6 | none |
| s8 reference converter | `schema/converter/` | `converter/test_converter.py`, `ts/test/converter-fixtures.test.ts` |
