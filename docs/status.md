# Status

Kept by the Orchestrator only (AGENTS.md, section 3). Updated in batches with merges.

## Now: phase PL0 (repository setup, ADRs, spike harnesses)

GitHub milestones cannot be created from the agents' tools, so each phase is a label (`PL0`, …)
until the owner creates the milestones.

| Issue | Lane | What | State |
|---|---|---|---|
| #1 | infra | CI skeleton, title check, worktree script | Merged (#7) |
| #2 | docs | ADR 0001 application stack, music link, timing | Merged (#6) |
| #3 | docs | ADR 0002 accounts, sign-in, pairing, tokens | PR #8, in review |
| #4 | player | Spike 1 music follower harness | PR #12, in review |
| #5 | scene | Spike 2 harness, web 3D | Merged (#11) |
| #9 | docs | ADR 0003 class format | Merged (#14) |
| #10 | infra | CI for node packages; worktree and change-detection fixes | Merged (#13) |
| #15 | docs | ADR 0004 provider terms | Merged (#16) |
| #17 | infra | Provider guard from ADR 0004 | In progress |
| #18 | scene | Spike 2 Godot variants | In progress |

## Carried into PL1

- ADR 0003 review notes (#14): same publication number with a different hash; a higher number
  after a removal; first song start 0 and last song end equal to class length; `song_timing`
  missing vs required windows; producer strict / reader lax mechanism; which hash after a major
  conversion; `time_in_zone_ms` key type.
- `worktree.sh rm` never deletes squash-merged branches (#13 review).

## PL0 is done when

All issues above are merged, and the owner has run both spikes (owner.md). Spike results are
recorded in a docs pull request; the timing ADR and the scene choice are confirmed or revised.

## Waiting for the owner

See [owner.md](owner.md).
