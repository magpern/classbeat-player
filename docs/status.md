# Status

Kept by the Orchestrator only (AGENTS.md, section 3). Updated in batches with merges.

GitHub milestones cannot be created from the agents' tools, so each phase is a label (`PL0`, …)
until the owner creates the milestones.

Updated 2026-11-25 (after #736; `main` at e9c112f).

## PL0: repository setup, ADRs and spike harnesses (done on fakes)

All issues are merged: CI (#1, #10, #17, #24, #33), ADRs 0001–0004 (#2, #3, #9, #15, #35),
spike 1 harness (#4), and spike 2 web and Godot variants (#5, #18). What is still open is the
owner's: running both spikes (owner.md). Open: a timeout on every CI job (#756), after
PR #680's `node-packages` job hung for almost three hours.

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
#253), sign-in returning to the companion page (#263, #274), also by an email link opened
in a new tab (ADR 0006, #330; backend #331, #332; site #329, #333), the `/me` answer in the contract
(#264, #272) and its backend route (#265, #283) with its account-filter tests (#295, #299;
#304, #305; #321, #322; #336, #338), the backend serving `/control` (#266, #273) and its hardening (#279, #281), the companion
and site specs as built (#269, #275; site sign-in wording and the signed-in mock-up, #341), response headers under a root prefix (#284, #285; #290,
#292; #339, #340, with a stricter private-import guard), the companion fake on the `/control` headers (#278, #286; #324, #327; #335, #337) and wider markup and stylesheet
guards (#267, #276), the companion CI states for paused-following, music not heard and song twice
(#282, #297), the companion spec asserting each state's words, the paused pill, live nudges and
token and zone colours on every border (#303, #306; #310, #311), zone outlines and every drawn side,
ancestor states and decoration colour in the companion, room and site checks (#316, #317; #319, #320), and the sink trap's iframe
realms and attribute-node writes (#293, #302), CSS `src()`, service workers, XHR and XSLT
documents (#307, #309), URL part setters with each value converted once (#312, #313), and a record page code
cannot blind, captured built-ins and navigation sinks (#315, #318), the private-import guard's
must-fail cases (#343, #345), the asset-rule parser, path table and limit plate checks (#344, #346)
and the web job on a change of the backend's control-page table (#347, #348).

**Riders (ADR 0007, done on fakes; Verifier clean on 70e101f and d5e45c4 (music link)):** ADR 0007 (#349), the design
specs for the rider page, the riders panel and the room QR codes (#358), the rider contract and
join route (#355), the rider page served at `/j` (#364), the `rider_state` builder and publish
policy (#363), the join route, rider tokens, lock, new code and remove (#367), the WebSocket rider
role (#370), the rider page (#369) and its address and header hardening (#374), the live client's
rider side with the riders panel and room join codes (#371), and the web job on a change of a page
policy the web tests read (#377). The companion page's CSP is the header policy only (#378).
Hardening from the reviews: the player's one drop per place and held-over drops (#381, #384), the
backend's late drops, close codes and counts (#382, #385; #397, #400), and the rider page's address
guard and the page-policy checks read from the browser (#398, #399). The Verifier ran join, remove, lock,
new code, rider isolation, the QR codes, the page address, the place states and `cancel_code` on
fakes at 70e101f, and the music link (follow, pause, Coasting, "Music not heard", relink) at
d5e45c4, Linux reader only, with no gaps.

**ADR 0005 amendment (2026-11-14, #354):** a controller token that ends frees its place, and the
app cancels a control code it no longer shows. Built: the contract's `controller_left` reason and
`cancel_code` (#368), the backend's reasons, place replay and `cancel_code` (#372), the presenter
freeing the place (#379) and the cancel when one display is left (#380).

**The player as a web app (ADR 0008, done on fakes; Verifier clean on 2221754):** ADR 0008 (#389),
the web job on a change of the shared clock surface (#391, #394), the backend accepting the `play`
return entry (#392, #395; its bound in #400), the `/play` spec (#390, #401), the backend image's web
stage with the shared clock surface (#404, #405), the `/play` page on the manual clock (#393, #403),
and the site's return entries and the "Play on this device" link (#396, #410). Hardening: the
live-session and sign-in notes from the reviews (#407, #409) and the specs as built (#408). The
Verifier ran sign-in and the way back (also from a new tab), the picker and a direct open, a whole
class on the manual clock with its keys, keep-awake and End, no request and no storage during a
class, the page headers, the class details link, the phone, small-landscape, tablet and room
layouts, and rules 1 to 4, 6 and 7, with no gaps. Not served yet: nothing in the repository serves
`dist/site/`, which ADR 0008 leaves to the deploy work; whoever serves it sends the site's page
headers and its path fallback (`/play` to `play/index.html`).

## PL2: backend and sign-in (done on fakes)

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
(#257, #259) and the passkey busy retry (#260, #262), and the other website pages on fakes: the
classes list, class details with "Play on this device" and delete (#418, #419), devices and
pairing (#420), account sessions, passkeys and "Confirm it is you" (#421), linked apps and
connecting an app (#422), and the data page with export and account deletion (#423); the site
spec and mock-ups as built (#428, #434); the follow-ups for export, devices, deletion and the
refused first request (#426, #430), the tighter site guards with a backslash refused in the
connect return address (#425, #436), and on the backend a sign-in ending the session the
browser held, a backslash refused in redirect addresses (#427, #431) and ADR 0002 as built
(#432, #433), the offline and guard follow-ups (#441), the spec touch-ups (#442), and the purge
counts with a new migration (#739, #747; the guard and docstring follow-up #751, #753).

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

## PL6: the room scene (web 3D, ADR 0009)

Merged: the scene direction (#471), a pure scene model (#526), the turn-rate limiter and moments
gate in the web 3D renderer (#536), the render-callback and lint fences (#549, #557, #564), the
text layer and the dark-under-text mask (#563), halved movement, the before-the-start look and the
strict S6 report (#569), the scene-only tokens (#581), the two-hue colour cross and the S6 budget
in the spec (#575), the 2D screen under the strict S6 measure in the spec (#584), the linear-light
renderer and the two-hue cross (#586), the house-look beam floor S5b in the spec (#588), and the
flash budget, its scheduler and the strict S6 gate on the canvas (#590).

Since then: the flash budget's tokens (#594, #596), the house-look beam floor S5b and its CI
check (#589, #599), the text layer on the scheduler and the whole-frame S6 gate (#591, #602), the
plain 2D screen under the strict measure (#583, #601), one mark ledger for the room window (#609),
the control band and join sheet under the strict measure (#585, #600), the room specs as built
(#607, #610, #621), steady light and sweeps as two kinds in the budget (#611, #615), beam aims held
2 s after an unforeseen cause (#617, #619), the haze and wall slowed to the steady-light cap (#616,
#620) and the 1 s cap on how far ahead an action joins a fixed frame (#608, #623).

**Rule gap (S6), since closed:** the sweep and sway windows (#618) did not yet fit the strict whole-frame
gate in every case. The revised sweep and sway spec is merged (#635: a turning beam moves in black,
near-miss turns join one dark span, zone 7 beams dimmed by a brightness scalar instead of widened);

Also merged: the player's state-rate test made deterministic (#624, #626), the 4.15 s sweep
windows with a burst's decay counted in the shared budget and gated (#618, #622; this closes the
known S6 gap above and #592), and scene.md as built after #592 (#671).

Open: mounting the scene in the room window (#677, PR #680), stepping the quality level down on a
low frame rate (#678, PR #740), and #717 (after #677). Design follow-up: the scene folds the grey circle
and square markers into one round dot; scene.md or `text.css` is to settle this.

## PL12: installed phone and tablet apps

Merged: the plan (#551), ADR 0011 (Capacitor, #553), spike 3 (an Android media-session follower
and frame-rate logger, #555) with its CI build (#560) and guard hardening (#561, #566, #568,
#573). The owner decided on 2026-11-15 that the app has two modes, instructor and rider
(ADR 0011 section 1, amended), and on 2026-11-24 that the app is built without waiting for the
spike 3 run (#634). Since then: the app's own screens in the spec (#628, #636, #639, #640,
#641), the locked-down Capacitor shell with its rule guards (#627, #637) and the CI debug APK with
the mobile tests (#629, #642).

Then: the mode holder (#630, #643), pairing with the Keystore token store and its plates (#631,
#651; spec as built #652, #655; the status row on wide screens #657, #658) and the music follower
behind a neutral reader (#632, #656). The app's backend calls and its Spotify reader wait for the
owner (#649, #653, [owner.md](owner.md)): until then pairing runs on a stand-in that fails as
offline, and the follower's stand-in reader reports "unavailable", so the phone runs on the manual
clock.

Since then: rider mode on a stand-in transport (#633, #666), hardening batch 1 (#670) and a
second mode question refused so the unpair call is always answered (#675). The owner decided on
2026-11-24 that iPhone riders use the installed app and that the iOS build starts once the
Android app is finished (#684).

Also merged: keeping the screen on during a class (#737) and the room screen on an external
display as the presenter view (#738, #748).

Open: a test of ModeController's keep-screen-on wiring (#749), a limit on how often a crashed
external display is shown again (#752, PR #755), and a rider line on the external display's idle
stage (#759). Waiting for the owner: the signing key, the backend transport (#649), the Spotify
reader (#653) and native Bluetooth sensors. The iOS app starts after Android (#684).

## PL9: sensors (ADR 0012), done on fakes

Merged: ADR 0012 (#660), the sensor core with parsers for heart rate, cycling and fitness-machine
data (#665), the sensor spec (#667) and its as-built batch (#679), the rider page reading the
rider's own sensor (#681) and its hardening (#704, #706, #712), the instructor's sensor panel on a
stand-in source (#674), a scan of every built player bundle for Bluetooth code (#696), and Bluefy
dropped (#684, #687).

**Done on fakes:** the Verifier ran PL9 on `main` at `e9c112f` (2026-11-25) and filed no gap
issues. The plan has no written "done when" for PL9, so the PL9 row and ADR 0012 section 6 served.
Every rule guard (no equipment control in the player or web, no Bluetooth in the player bundle,
no equipment word or rider-bound data in live messages) failed under one mutation each. Waiting
for the owner: reading sensors on the computer, riders' readings sent to the instructor, and real
bikes and phones ([owner.md](owner.md)). Not filed: no Electron e2e test drives the instructor's
sensor panel; the shots harness covers it.

## PL11: Swedebeat playback (ADR 0013), done on fakes

Merged: ADR 0013 (#683) with the owner's questions (#694), `music.swedebeat_mix` in class format
1.3 (#695, #701), the Connect Swedebeat and mix-state spec (#699), the mix source interface, guards
and mode policy (#700), sign-in and sign-out on the class list (#708) and its hardening (#723,
#728, #727), the encrypted mix cache (#710, #716), mix playback in the room window (#718), the
ending mark and its flushes (#731, #734), and the as-built records (#714, #721, #726, #732, #736).

**Done on fakes:** the Verifier ran PL11 on `main` at `e9c112f` (2026-11-25) and filed no gap
issues, against ADR 0013 and swedebeat.md (the plan has no written "done when" for PL11). It
covered play while downloading, no plaintext in the cache, the class clock matching the audio,
the fall-back to the manual clock with a reason, and the `cbp-mix:` hardening. Revoked tokens,
mid-class fall-back, cached play offline and the paired class list's mix states are covered by
unit tests only. Waiting for the owner: Swedebeat's agreement and the real source client (plan
decision 11, ADR 0013 section 7).

## PL7: release

Issues written 2026-11-25: the desktop release workflow with unsigned builds (#760), the
updater's ADR (#762, security-critical), the release runbook (#763) and the download page spec
(#764). Signing and notarisation wait for the owner's signing identities (owner.md).

## PL10: running classes and treadmill reading

The design is being settled first in an ADR (#765, rule-sensitive: the treadmill is read, never
controlled). Testing on a real treadmill waits for the owner.

## Infra

Merged: the desktop app built and tested on Linux, macOS and Windows, with unsigned packages
(#75, #76); the backend job also runs for changes under `schema/` (#88, #93); the class list
screenshots are uploaded whenever the shot tests exist (#139, #140); the `web` job also runs for
the shared design tokens and the request policy (#268, #271); the backend image ships
`web/dist/control` (#277, #280) and the generated schema models (#287, #288); the dockerignore
check compares the whole file in order (#289, #291; #294, #296; #298, #300; #325, #326); the
backend image ships `web/dist/j` too, with its contents checked (#387, #388); the web spec
checks run in five parallel shards (about 8 minutes instead of 27) and a change to documentation
only runs no tests (#435, #437; follow-ups #438, #439); the scene's screenshot tests run in their own job, only when
the scene can change, so the other Node package tests take about 8 minutes instead of 46 (#644,
#645).

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

- Website: the notes from the #419 to #423 reviews are done (#430, #431, #434, #436). Open: no
  site state opens `/` or `/account`, so the redirect there is outside the history allowlist
  (#436 N1), the offline export and add-passkey buttons (#430 design), and the shared shot names
  (#439 N2), in #441 and #442. From #431: no test that a busy or rate-limited passkey sign-in
  ends nothing (N3).

- PL12 notes: an instrumented test of the Keystore store and a network-security config for the
  debug loopback (#651 N2, N4, both with #649); the cache deleted at once on a removed device,
  against ADR 0002 section 6, to revisit when the room plays from the cache (#651 N3); tests for
  the unpair question flow, the follow bridge's own mode check and the listener switched off at
  start (#651 N7, #656 N3); the expired plate with three classes 25 px over at 360x640 and 18 px at
  640x360 (#651, #658 design reviews); the follow sheet must not offer notification access while
  the reader is the stand-in (#656 N2); the listener guard could also ban `Class.forName` and
  `getMethod` (#656 N1, with #653); a long comment in `reader.ts` (#656 N4).

- PL8 notes: from #273, HEAD on `/control` answers 405 (by design); from #340, the
  private-import guard does not follow names reached through a container or `self`.

- ADR 0008 notes: a replaced phone's one in-flight command frame gets its own rate window (#409
  N1: ignore commands from a closing connection); the canonical class id pattern is defined twice
  in `web/` and the backend drift test reads the Python source as text (#410); the backend image's
  web stage would need `schema/generated` if `tsc` ever ran there (#405); the class details spec
  should place "Play on this device" beside "Delete class" (#410 design review).

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
window stays for a second display. The studio's one screen is mirrored on the projector (owner,
2026-11-14), so spike 2 is run that way: plan section 9 updated, the harness's one-screen mode is
#447.

## Waiting for the owner

See [owner.md](owner.md).
