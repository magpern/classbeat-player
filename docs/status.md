# Status

Kept by the Orchestrator only (AGENTS.md, section 3). Updated in batches with merges.

GitHub milestones cannot be created from the agents' tools, so each phase is a label (`PL0`, …)
until the owner creates the milestones.

Updated 2026-11-12.

## PL0: repository setup, ADRs and spike harnesses (done on fakes)

All issues are merged: CI (#1, #10, #17, #24, #33), ADRs 0001–0004 (#2, #3, #9, #15, #35),
spike 1 harness (#4), and spike 2 web and Godot variants (#5, #18). What is still open is the
owner's: running both spikes (owner.md).

## PL5: music link (done on fakes)

Merged: link core (#38), macOS reader (#43), hardening (#46), Windows reader (#45), Linux reader
(#50), shared reader lifecycle (#59). The Verifier's run on `main` found three gaps, now issues
#62 (Start while following, PR #66), #63 (after #62) and #64 (holding status text, PR #65). The
live checks with a real Spotify account are the owner's (owner.md).

## PL2: backend and sign-in

Merged: service skeleton, roles and migrations (#32), email link sign-in and site sessions (#54),
sign-in hardening (#60), ADR 0002 as built (#57, #67). In progress: device pairing (#58, PR #61).
Next: the source API, the class library, passkeys; the real mailer with an enforced timeout,
the allowlist command, a purge schedule, `PLAYER_SITE_ORIGIN` and trusted proxies in deploy files.

## PL4: screens

PR #31 (design system and the plain 2D room screen spec, #22): Design `PASS`, under review.
Screen tokens and the plain 2D room screen follow it.

## Scene spike

Merged: #30 and its findings (#53).

## Decisions recorded

- ADR 0002 section 9 item 1 (amended in #40): string-built SQL is held by an executor that alone
  owns the driver and runs only registered `Query` objects, with a source guard aimed at
  mistakes. After four `FAIL`s on a source-only guard, the Orchestrator reassessed the design.
- ADR 0002 principle 7 (#57): limits that bound the app's database role are constants in the
  database functions and change by migration in a security-critical pull request.
- Another app playing while following shows "Off the list" (ADR 0001).
- A reader that cannot start six times reports following as unavailable on that computer (#59).

## Later hardening (non-blocking findings)

- Player: reader findings N3, N4, N6, N7 from #59; presenter layout notes from #38; a test that
  stopping the native scene clears its state (#53); one capitalisation convention for status
  texts (#65 design review).
- Backend: a test that a request over the per-email total leaves the older link; the
  `auth_session_active` stub.

## Carried into PL1

- ADR 0003 review notes (#14): same publication number with a different hash; a higher number
  after a removal; first song start 0 and last song end equal to class length; `song_timing`
  missing vs required windows; producer strict / reader lax mechanism; which hash after a major
  conversion; `time_in_zone_ms` key type.
- `worktree.sh rm` never deletes squash-merged branches (#13 review).

## Waiting for the owner

See [owner.md](owner.md).
