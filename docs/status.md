# Status

Kept by the Orchestrator only (AGENTS.md, section 3). Updated in batches with merges.

GitHub milestones cannot be created from the agents' tools, so each phase is a label (`PL0`, …)
until the owner creates the milestones.

Updated 2026-11-13 (after #261).

## PL0: repository setup, ADRs and spike harnesses (done on fakes)

All issues are merged: CI (#1, #10, #17, #24, #33), ADRs 0001–0004 (#2, #3, #9, #15, #35),
spike 1 harness (#4), and spike 2 web and Godot variants (#5, #18). What is still open is the
owner's: running both spikes (owner.md).

## PL5: music link (done on fakes)

Merged: link core (#38), macOS reader (#43), hardening (#46), Windows reader (#45), Linux reader
(#50), shared reader lifecycle (#59), and the gaps the Verifier found on `main`: Start while
following (#62, #66), Next and Previous say what they do while following (#63, #69), hardening (#70, #72), the holding status text
(#64, #65). The live checks with a real Spotify account are the owner's (owner.md).

## PL1: the class format (done)

Merged: the class format schema and generated types (#23), the reference converter from
classbeat's data shape with example classes (#27), the player API answers in `schema/` (#106, #109).

## PL8: live sessions, first the handlebar companion

ADR 0005 (#166) decides transport, control and the contract; issues #167 to #174 follow its
section 9. Merged: the contract `schema/live/v1` with its rule guards (#167, #176), the live
re-check functions and revocation notices (#168, #175), the companion state and command intake in
the player (#172, #177), live sessions in the backend (#169, #178), the player's live client and
panel (#173, #200; the `WebSocket` exception decided by the owner), the session ender (#203,
#204) and its hardening (#205, #210), the control code as a QR (#201, #206), the quit that waits
for the live `end` (#211, #212) and its hardening (#216, #217), the audit of sessions that end on
expiry outside the sweep (#220, #225), the tighter routing table and string bounds (#221, #223),
the live publisher and listener hardening (#222, #224), the contract tests (#228, #229), the
backend hardening (#227, #230), the body cap in the live contract (#234, #235; #237, #238; #236,
#239; #240, #241) and the live audit writes at shutdown with their tests (#242, #243; #244,
#245), the companion page (#174, #261; network calls in web code allowed by the owner, #252,
#253), sign-in returning to the companion page (#263, #274), the `/me` answer in the contract
(#264, #272) and its backend route (#265, #283) with its account-filter test (#295, in review
#299), the backend serving `/control` (#266, #273) and its hardening (#279, #281), the companion
and site specs as built (#269, #275), response headers under a root prefix (#284, #285; #290,
#292), the companion fake on the `/control` headers (#278, #286) and wider markup and stylesheet
guards (#267, #276). In progress: companion CI states (#282, #297), the sink trap's iframe and
attribute-node gaps (#293).

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
their hardening (#136, #145; #146, #147: the sign-in lock never waits, one lock registry; #158,
#160: the account-sessions and passkey-additions locks wait at most 2 s), the
website pages spec (#131, #137), the website shell, sign-in and error pages (#144, #256), sign-in hardening from its review
(#257, #259) and the passkey busy retry (#260, #262). Next: the other website pages, purge counts (needs a
migration).

## PL4: screens

Merged: the design system and the plain 2D room screen spec (#22, #31), and its follow-ups (#78,
#91); class sync and the offline cache (#111, #113); the room screen (#77, #85), its spec as
built (#124) and its hardening (#119, #128, which also settles #122); sync hardening (#114, #121);
the presenter window's minimum size (#123, #126); the class list spec (#116, #125) and its data
(#129, #132); the class list screen (#133, #138) and its hardening (#142, #143); the room screen
in its own window (#141, #148) and its follow-ups (#149, #151: the presenter kept clear, File >
Show the room screen, a run-time check that refuses any renderer with loose web preferences);
shell hardening (#152, #154; #155, #156: preloads, spell checker, shell handlers, re-checked on
every navigation; #162, #165: a refusal never throws out of the shell listeners, keep-awake wiring
tested); keep-awake while a class runs (#157, #159). **Done on fakes:** the Verifier ran the PL4 "done when" on
`main` at `e2d7c6c` (#159) and filed no gap issues; #165 merged after it. The lasting-fault plate and the display removal are covered by unit tests
only (memory keychain, one xvfb display).

## Infra

Merged: the desktop app built and tested on Linux, macOS and Windows, with unsigned packages
(#75, #76); the backend job also runs for changes under `schema/` (#88, #93); the class list
screenshots are uploaded whenever the shot tests exist (#139, #140); the `web` job also runs for
the shared design tokens and the request policy (#268, #271); the backend image ships
`web/dist/control` (#277, #280) and the generated schema models (#287, #288); the dockerignore
check compares the whole file in order (#289, #291; #294, #296; #298, #300).

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
- Backend: packaging of `schema/`
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
- Backend: from the #160 review, a table test that only 55P03 counts as `busy` (N1), a test that
  a transaction goes on after a timed-out `lock_additions` (N2), and `passkey_policy.py` at 157
  lines (N3).
- Player: from the #156 review, e2e tests 11 and 12 should also assert that `did-navigate` never
  fires and the session preload never runs; `refuseLoose` calls `isDestroyed`, `console.error`
  and `close` outside its `try`; a timeout on each e2e test. From the #159 review, nothing tests
  the keep-awake release on presenter `closed` and `will-quit` in `main.ts`.
- Screens: the website should resend after `Retry-After` on link completion and passkey
  addition as well as passkey sign-in (#160; for #144).
- Screens: the one-display rehearsal room window draws a narrow strip at about 490 px wide; an
  issue if instructors find it unreadable (#151 design review). The presenter spec (PL5) should
  say one line on the fallback where the room window sits behind the presenter.
- Player: pairing keychain notes from #89 (the redundant chmod, the cleanup error, a two-origin
  test).

- Backend: from the #164 review, `lock_additions` swallowing an error other than 55P03 survives
  the tests. From the #175 review: "a refused revoke sends no notice" rests on the route's
  rollback, so a function-level test and a test of the refused-session route (N1); the rollback
  test should check the device is still active (N2); `end_all_sessions` notifies with nothing
  ended (N3, harmless); a comment that a future stub needs a fail-closed test (N4).
- Contract: from the #176 reviews, the shape check should require `maxLength` on strings (ADR
  0005 says strings are bounded; all are today); the TS suite covers 16 of the Python suite's 21
  ways of opening a schema; `duplicate` always has a null reason.
- Player: from the #165 review, the hardening and wiring checks are source regexes; the #165
  Developer notes one outer `try` in `refuse-loose.ts` that no test reaches. A one-off macOS hang in `room-window-lifecycle`
  test 2 is unexplained; its steps now fail within 10 s naming the step.

- PL8 notes: from #274, `RETURN_ENTRIES` could use `satisfies`, a sign-in by email link opened
  in a new tab lands on `/classes` (needs a return entry in the mailed link), and `site.md`
  wording; from #275, `companion-pages.js:117` still shows a sample signed-in address; from #273,
  HEAD on `/control` answers 405; from #286, the fake's header check ignores headers with constant
  values, copies the asset rule, and the socket entry is only text-checked; from #292, the
  private-import scan misses dynamic forms; from #300, an empty dockerignore fails without a
  message.

## Carried into PL8

- Deleting an account ends its live sessions (ADR 0002 section 12, #112 review): an acceptance
  criterion of #169.

## Carried into PL1

- ADR 0003 review notes (#14): same publication number with a different hash; a higher number
  after a removal; first song start 0 and last song end equal to class length; `song_timing`
  missing vs required windows; producer strict / reader lax mechanism; which hash after a major
  conversion; `time_in_zone_ms` key type.
- `worktree.sh rm` never deletes squash-merged branches (#13 review).

## One screen (owner, 2026-11-13)

The owner tried the Mac build on one screen: the room window hid the presenter window and its
Start button. The owner decided the class runs on one screen (plan section 3). Merged: the room
screen's controls spec (#195, #209, #214), the room window bridge (#197, #199), the controls band
with clicker keys and the room window filling a single display (#198, #207), the phone-remote
slot joined to the live client (#202, #213), its "Can't reach site" retry (#215, #218) and the
rail texts for following stopped (#208, #251; pushed at the owner's request). The presenter
window stays for a second display.

## Waiting for the owner

See [owner.md](owner.md).
