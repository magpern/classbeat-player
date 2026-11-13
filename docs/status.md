# Status

Kept by the Orchestrator only (AGENTS.md, section 3). Updated in batches with merges.

GitHub milestones cannot be created from the agents' tools, so each phase is a label (`PL0`, …)
until the owner creates the milestones.

Updated 2026-11-13.

## PL0: repository setup, ADRs and spike harnesses (done on fakes)

All issues are merged: CI (#1, #10, #17, #24, #33), ADRs 0001–0004 (#2, #3, #9, #15, #35),
spike 1 harness (#4), and spike 2 web and Godot variants (#5, #18). What is still open is the
owner's: running both spikes (owner.md).

## PL5: music link (done on fakes)

Merged: link core (#38), macOS reader (#43), hardening (#46), Windows reader (#45), Linux reader
(#50), shared reader lifecycle (#59), and the gaps the Verifier found on `main`: Start while
following (#62, #66), Next and Previous say what they do while following (#63, #69), hardening (#70, #72), the holding status text
(#64, #65). The live checks with a real Spotify account are the owner's (owner.md).

## PL2: backend and sign-in

Merged: service skeleton, roles and migrations (#32), email link sign-in and site sessions (#54),
sign-in hardening (#60), ADR 0002 as built (#57, #68 and this update), device pairing (#58, #61),
pairing hardening (#71, #79), pairing in the app (#74, #84; hardening #87, #89), the source API
(#73, #86), the SMTP mailer and operator commands (#83, #90), the player API with class sync
(#92, #96), refused requests counted on every credentialed route and review notes (#98, #101),
backend deploy files with the hourly purge (#95, #97, #99, #100). Next: the class library,
passkeys; purge counts (needs a migration); the player API answers in `schema/`.

## PL4: screens

Merged: the design system and the plain 2D room screen spec (#22, #31), and its follow-ups (#78,
#91). In progress: the room screen (#77, PR #85).

## Infra

Merged: the desktop app built and tested on Linux, macOS and Windows, with unsigned packages
(#75, #76); the backend job also runs for changes under `schema/` (#88, #93).

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
- Backend: the `auth_session_active` and `auth_device_active` stubs (PL8); packaging of `schema/`
  (#86); a size cap on site request bodies and a guard that the raw body is read before the
  session, a test that the SMTP conversation releases its deadline, the DNS lookup inside the
  deadline (#101 review); a separate budget for document reads so a first sync of 2,000 classes
  does not take 34 minutes, cursors bound to an account, a resync on a format-version change (#96).
- Docs: the presenter spec's minimum window size; the short next row's dropped fields called a
  choice (#91 reviews); ADR 0002 notes from #94 (the Linux keychain backends, idle link rows, the
  section 6 bullet on one device token per account against one pairing at a time).
- Player: pairing keychain notes from #89 (the redundant chmod, the cleanup error, a two-origin
  test).

## Carried into PL1

- ADR 0003 review notes (#14): same publication number with a different hash; a higher number
  after a removal; first song start 0 and last song end equal to class length; `song_timing`
  missing vs required windows; producer strict / reader lax mechanism; which hash after a major
  conversion; `time_in_zone_ms` key type.
- `worktree.sh rm` never deletes squash-merged branches (#13 review).

## Waiting for the owner

See [owner.md](owner.md).
