# Status

Kept by the Orchestrator only (AGENTS.md, section 3). Updated in batches with merges.

GitHub milestones cannot be created from the agents' tools, so each phase is a label (`PL0`, …)
until the owner creates the milestones.

Updated 2026-11-12.

## PL0: repository setup, ADRs and spike harnesses (done on fakes)

All issues are merged: CI (#1, #10, #17, #24, #33), ADRs 0001–0004 (#2, #3, #9, #15, #35),
spike 1 harness (#4), and spike 2 web and Godot variants (#5, #18). What is still open is the
owner's: running both spikes (owner.md).

## Work in progress

| Issue | Lane | What | State |
|---|---|---|---|
| #20, #26 | contract | Class format schema, generated types, reference converter | Merged (#23, #27) |
| #29 | player | Desktop shell skeleton, class files, class clock | Merged (#36) |
| #37 | player | Music link core: link states, following the music | Merged (#38) |
| #41 | player | macOS music reader | Merged (#43) |
| #44 | player | Music link hardening from the #38 and #43 reviews | Merged (#46) |
| #42 | player | Windows music reader | PR #45, in progress |
| #47 | player | Linux music reader (best effort) | In progress |
| #22 | docs | Design system and the plain 2D room screen spec | PR #31, fixing after a second `FAIL` |
| #28 | backend | Service skeleton, database roles, migrations | PR #32, fixing one finding |
| #39 | docs | ADR 0002: two-layer SQL guard and its scope | Merged (#40) |

## Decisions recorded

- ADR 0002 section 9 item 1 (amended in #40): string-built SQL is held by an executor that alone
  owns the driver and runs only registered `Query` objects, with a source guard aimed at
  mistakes. After four `FAIL`s on a source-only guard, the Orchestrator reassessed the design.
- The macOS reader opens a class on the manual clock and calls Spotify only once Follow is
  picked (#43).

## Next

- After #45 and #47: transport control and the crossfade check, which finish PL5 on fakes.
- After #32: PL2 sign-in functions, sign-in, pairing and the source API.
- After #31: PL4 screen tokens and the plain 2D room screen.
- Non-blocking findings for later hardening issues:
  - scene spike #30: the 1–9 keys in native Godot, the hidden window on more than one display,
    a malformed `godotweb://` request, a test timeout;
  - presenter layout notes from the design review of #38.

## Carried into PL1

- ADR 0003 review notes (#14): same publication number with a different hash; a higher number
  after a removal; first song start 0 and last song end equal to class length; `song_timing`
  missing vs required windows; producer strict / reader lax mechanism; which hash after a major
  conversion; `time_in_zone_ms` key type.
- `worktree.sh rm` never deletes squash-merged branches (#13 review).

## Waiting for the owner

See [owner.md](owner.md).
