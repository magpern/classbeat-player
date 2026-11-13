# Status

Kept by the Orchestrator only (AGENTS.md, section 3). Updated in batches with merges.

GitHub milestones cannot be created from the agents' tools, so each phase is a label (`PL0`, …)
until the owner creates the milestones.

Updated 2026-11-13 (after #151).

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
backend deploy files with the hourly purge (#95, #97, #99, #100), the body size cap, a budget of
600 document reads a minute, counted oversized publications and the SMTP deadline over DNS and
connect (#103, #104), the player API answers in `schema/` (#106, #109), the class library on the
site (#107, #110), account export and deletion (#108, #112), cursors bound to an account, the
body cap keyed on the route and the class paging index (#115, #127), passkeys (#130, #134) and
their hardening (#136, #145; #146, #147: the sign-in lock never waits, one lock registry), the
website pages spec (#131, #137). In progress: the website shell and sign-in (#144), held on a
question for the owner (owner.md). Next: the other website pages, purge counts (needs a
migration).

## PL4: screens

Merged: the design system and the plain 2D room screen spec (#22, #31), and its follow-ups (#78,
#91); class sync and the offline cache (#111, #113); the room screen (#77, #85), its spec as
built (#124) and its hardening (#119, #128, which also settles #122); sync hardening (#114, #121);
the presenter window's minimum size (#123, #126); the class list spec (#116, #125) and its data
(#129, #132); the class list screen (#133, #138) and its hardening (#142, #143); the room screen
in its own window (#141, #148) and its follow-ups (#149, #151: the presenter kept clear, File >
Show the room screen, a run-time check that refuses any renderer with loose web preferences).
In progress: shell hardening from the #151 review (#152).

## Infra

Merged: the desktop app built and tested on Linux, macOS and Windows, with unsigned packages
(#75, #76); the backend job also runs for changes under `schema/` (#88, #93); the class list
screenshots are uploaded whenever the shot tests exist (#139, #140).

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
  (#86); a resync on a format-version change (#96); the inner-document 413 counted as use, and
  one long line (#102 notes). From the #127 review: two accounts' cursor ranges almost never
  overlap, but nothing forbids it (N1); rows created with base 0 before migration 0010 keep it
  and need a re-basing migration (N2); N3 and N4 are in the review comment.
- Docs: the short next row's dropped fields called a choice (#91 reviews); ADR 0002 notes from #94 (the Linux keychain backends, idle link rows, the
  section 6 bullet on one device token per account against one pairing at a time).
- Player: a class answered `unusable` is skipped and the cursor moves past it, so an older cached
  copy stays with nothing marked newer, by design; the class list marks it "not updated" (#113
  N2, #132).
  Positions above 2^53 are refused, which stalls sync rather than corrupting it (#113 N4).
- Player: `sync-model.ts` is at 296 lines, so its next change splits it; `list()` reads and
  hashes every cached file, so the screen calls it only when the sync view changes (#132 review).
- Screens: the zone-word check skips words over 16 letters; the next-row gap check has a 0.5 px
  tolerance (#128 review).
- Player: the class list's lasting-fault panel says "restart the player" and its plate "Restart
  the app"; one word when the panel is next touched (#143 design review). The #143 source test
  of the wiring catches a deleted line, not a semantic change; moving that glue into a unit-tested
  module, and making the drop callback of `registerHandlers` required (#143 review).
- Backend: the account locks 7270003 and 7270011 still wait without a limit (#147).
- Screens: the one-display rehearsal room window draws a narrow strip at about 490 px wide; an
  issue if instructors find it unreadable (#151 design review). The presenter spec (PL5) should
  say one line on the fallback where the room window sits behind the presenter.
- Player: pairing keychain notes from #89 (the redundant chmod, the cleanup error, a two-origin
  test).

## Carried into PL8

- Deleting an account ends its live sessions (ADR 0002 section 12, #112 review): an acceptance
  criterion of the live-session issues.

## Carried into PL1

- ADR 0003 review notes (#14): same publication number with a different hash; a higher number
  after a removal; first song start 0 and last song end equal to class length; `song_timing`
  missing vs required windows; producer strict / reader lax mechanism; which hash after a major
  conversion; `time_in_zone_ms` key type.
- `worktree.sh rm` never deletes squash-merged branches (#13 review).

## Waiting for the owner

See [owner.md](owner.md).
