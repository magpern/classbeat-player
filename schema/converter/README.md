# Reference converter

ADR 0003 section 8: a pure Python function, `reference_converter.convert`, from a fixture in
classbeat's data shape to a class document of format v1. Used only by tests; classbeat ports it
in PL3 and this repository never reads classbeat's code or database. The fixture shape is
written from the public field names of classbeat's class data (the interval, segment and song
fields named in ADR 0003 Context) and nothing is copied or imported.

## Files

| Path | What |
|---|---|
| `reference_converter.py` | `convert(fixture) -> document`, `ConversionError`. Standard library only, no I/O |
| `fixtures/<name>.input.json` | A class in classbeat's shape |
| `fixtures/<name>.expected.json` | The document `convert` must give; also an example class for the player (valid in strict and reader mode, checked in Python and TypeScript) |
| `test_converter.py` | Fixture to expected document, validator verdict, and the mapping rules below |

Fixtures: `class-45min-crossfade-9s` (cycling, crossfade 9 s, a 5 minute FTP test),
`class-30min-crossfade-off` (crossfade 0), `class-40min-game-and-ftp-test` (a game that is
dropped and a 20 minute FTP test that is kept).

## Fixture shape

```
{ name, description?, sport?: "cycling" | "running",
  segments: [ { name, kind, intervals: [ { sec, zone, rpm | gradient, standing?, game?, ftp_test?, cue? } ] } ],
  music?: { crossfade_sec, songs: [ { spotify_id, title, artist, bpm?, length_sec } ] } }
```

## Mapping: each classbeat field and what happens to it

| classbeat field | In the document | ADR 0003 rule |
|---|---|---|
| interval `sec` (whole seconds) | `length_ms` = sec x 1000; `start_ms` is the running sum | s2 whole milliseconds; s4 intervals tile from 0 |
| interval `zone` | `zone`; `zone_scale` lists only the zones used, `totals.time_in_zone_ms` sums per zone | s3 zone scale travels with the class; s4 totals agree |
| interval `rpm` `[from, to]` | `cadence: {from, to}` | s3 |
| interval `rpm` `"beat"` | `cadence: "beat"` | s3 |
| interval `standing` true/false | `position: "standing"` / `"seated"` | s3 |
| running `gradient` 0 / 1 | `incline: "flat"` / `"raised"`; no cadence or position | s3, s4 (running reverse) |
| interval `cue` | `cue`, whitespace collapsed (limit 120 is the same in both) | s2, rule 10 |
| interval `game` | **dropped**; nothing in the document names it | s3 "a source's games are not part of the format" (rule 15) |
| interval `ftp_test` 3 / 5 / 20 | `test: {kind: "ftp", minutes}` (cycling only) | s3 |
| segment `name`, `kind` | `segments[]` with the same name and kind | s3 |
| segment `intervals` | `start_ms` / `end_ms` computed from its first and last interval | s4 segments cover whole intervals |
| class `name` (at most 100) | `class.title`, cut to 80 characters | s2 names at most 80 |
| class `description` | `class.description` when not empty | s3 |
| class `sport` (absent = cycling) | `class.sport` | s3 |
| sum of interval lengths | `class.length_ms` and `totals.length_ms` | s4 |
| `music.crossfade_sec` | `music.design_crossfade_ms`, seconds x 1000 | s3, ADR 0001 |
| song `spotify_id` | `songs[].ids.spotify_track` | s3 |
| song `title`, `artist` | same, whitespace collapsed | s3 |
| song `length_sec` | `length_ms` | s2 |
| song `bpm` | `bpm`; left out when outside 30 to 300 (unknown) | s3 |
| song order and lengths | window: a song starts one crossfade before the previous one ends (`end_ms` = `start_ms` + length - crossfade); the first starts at 0 and the last ends at the class length; a window that is empty or longer than its song is a `ConversionError` | s4 contiguous windows, window at most the song |
| (no field in classbeat) | `song_timing: "estimated"`: windows come from lengths, not from audio | s3, s5 |
| no `music` or no songs | `music.source: "none"`, crossfade 0, `song_timing: "missing"`, `songs: []` | s3, s5 |
| (no field in classbeat) | `zone_scale` names and ranges come from a default table in the converter; classbeat's data carries none | s3 (a converter choice, not data) |
| (no field in classbeat) | no `beat_anchors`, `moments`, `planned_load` | s3 optional fields; s5 |

Not in the fixture shape, so not mapped: MOWL ids and links, playlists, cover images, roles and
anything else of classbeat's that the format has no field for (strict schema: such a field
cannot be carried).
