# 0005. Live sessions and the handlebar companion

Status: Proposed

## Context

PL8 starts with **the handlebar companion** (plan sections 3 and 12): the instructor's phone on
the handlebar is a teleprompter (the coaching cue in large type, the next intervals, the next
song change) and a remote (start, pause, skip, nudge). It is a web page, nothing to install.
Riders' phones come later in PL8 on the same live session.

What this ADR takes as given:

- Rule 2: the product never controls equipment. The companion steers the player only.
- Rule 14 and plan section 3: controlling the class needs the instructor's own sign-in or a
  one-time code shown only on the instructor's screen, never the riders' join code. Rule 13:
  rider data flows from the rider to the instructor only.
- [ADR 0001](0001-application-stack-music-link-and-timing.md): the class clock runs inside the
  player and never stops because a connection dropped; while following, start, pause and next go
  to the music app; a resync of more than 5 s is announced "on the instructor's screen and the
  companion" with a one-touch undo.
- [ADR 0002](0002-accounts-sign-in-pairing-and-tokens.md) section 8 already decides the live
  session's credentials and limits: the one live process, `POST /api/live/sessions` with a device
  token, the host token, one session per device and 3 per account, the lifetimes, the re-check
  every 30 s with `auth_device_active` and `auth_session_active`, the `live_revocations` hint,
  control by sign-in or by control code, controller tokens `cbp_ctl_`, at most 2 controllers,
  the WebSocket `hello`, the message limits and the routing allowlist. Section 10 holds the live
  limits, section 13 the threats. This ADR keeps all of it except the controller's command
  set, which section 10 amends (two actions added). It decides what 0002 left to PL8: the
  transport in practice, the run of a session, the contract, the command semantics, failure
  behaviour and the issue split.
- [ADR 0003](0003-class-format.md): an interval has `start_ms`, `length_ms`, `zone` and a `cue`
  of at most 120 characters; songs have title, artist and their window in class time.
- What exists: the player's pure `core/commands.ts` (`ClockCommand`: start, pause, resume, next,
  previous, jump ±5000 ms, undo, manual, follow, pick) and `core/link/while-following.ts`
  (routes a command to the music app or hands the clock over); `core/snapshot.ts` (what the
  presenter is sent); the backend runs as one process on purpose
  (`docker/backend-entrypoint.sh`); `auth_device_active` and `auth_session_active` are stubs
  that raise (migration `0003_auth_functions.sql`); status.md carries into PL8 "deleting an
  account ends its live sessions".

## Decision

### 1. Transport: through the backend, outbound only

- **The phone reaches the player only through the backend's live process**, over the one
  WebSocket of ADR 0002 (`wss://<site>/api/live/ws`). The player and the phone each open an
  outbound TLS connection to the site. Nothing listens on the studio computer: no inbound port,
  no local server in the app, no local discovery (mDNS, broadcast) and no Bluetooth link to the
  phone. This works on studio and guest Wi-Fi that isolates clients, and on mobile data.
- **The player is authoritative.** It owns the class clock and the music link. The live process
  is a relay: it checks credentials, validates each message against its closed schema, routes it
  by the allowlist and keeps nothing but the current session state of ADR 0002. It never makes
  a command, never changes a state message and never buffers a command for a host that is away.
- **The phone is a view and a set of buttons.** It shows what the host last published and
  interpolates the countdowns between messages with its own monotonic clock. It never changes
  what it shows as if a command had worked before the host says so.
- Latency through the relay (typically 50 to 300 ms) is inside the 1 s interval target; the
  companion is never used for beat effects.

### 2. The live session and its run

- A session is started by a **paired** app, on the instructor's request ("Phone remote" in the
  presenter), never automatically. An app with no pairing (class files only) or no network has
  no companion and says why. Default setting: off at each start of the app.
- **A session belongs to one class run.** It starts while a class is open and ends when the
  instructor ends it, closes that class or opens another one; the next class is a new session
  with new codes. The app gives each run a random `run` id (16 bytes, base64url) sent in every
  state message. The rest of the lifetime is ADR 0002's: one per device (a new one ends the
  earlier), 3 per account, 15 minutes after the host connection is lost, 12 hours at most.
  A start that would make a fourth session on one account (3 already running on other devices)
  is refused with 409 `sessions_full` (amended 2026-11-13, #176: neither ADR named the answer).
  *Default behind the app's live-session interface:* carrying one session into the next class is
  a later, reviewed change; nothing in the messages assumes either way.
- **Ending.** The host sends `end` over its connection, or the live process ends the session by
  ADR 0002's rules. Every connection is closed with 4403; the app shows "phone remote ended" and
  the class goes on.
- **Account deletion and device revocation end the session**: the site's deleting or revoking
  transaction calls `pg_notify('live_revocations', <account id>)`, the live process re-checks at
  once, `auth_device_active` answers not active, the session ends. A missed notification is
  caught by the 30 s re-check. This is an acceptance criterion with a test in the backend issues
  (status.md, "Carried into PL8").
- In the companion part of PL8 **no rider route exists** (`POST /api/live/join` is built with the
  riders). The join code only names the session for the two controller routes of ADR 0002. The
  room screen shows nothing of the session.

### 3. Control authority

ADR 0002 section 8, restated so the issues can check it, with the one change of section 10:

- *By sign-in.* The phone is signed in on the site with the host's account and sends the join
  code to `POST /api/live/controller`. The controller token ends with that site session.
- *By control code.* The host asks for a code over its connection (`make_code`, section 4); the
  live process answers `control_code` to the host only, and the app passes it to the presenter
  window only, never to the room window. The presenter shows it and a QR code of
  `https://<site>/control#<join code>.<control code>`. 2 minutes, single use, 5 wrong tries per
  session cancel it (the host gets `code_cancelled`), 30 codes per session per hour. An app with
  one display offers no control code: sign-in only.
- The phone gets a controller token `cbp_ctl_`, hashed in the live process's memory, kept on the
  phone in `sessionStorage` of the site's origin only, the fragment removed from the address bar
  at once. It ends with the session, when the host drops it, or with its site session.
- **At most 2 controllers** (a phone and a spare), counted as controller tokens held. A third
  request by sign-in gets `cannot_control`, like every failure there. A right control code while
  both places are held gets `controllers_full`, is not used up and is not counted as a wrong try;
  a wrong code is counted as before, whatever the places. The host frees a place with `drop`;
  a `drop` also ends the current control code, so the freed place needs a new one (amended
  2026-11-13, #166 review). The host is sent nothing for it: the app clears the shown code and
  its QR code when it sends `drop`, and `code_cancelled` keeps its four reasons (`used`,
  `expired`, `wrong_tries`, `replaced`). A malformed code, on the sign-in route or the code route, gets 422
  `invalid_request` like any malformed body; it tells nothing about the session (#176 review).
- The server gives each controller its `slot` (1 or 2) and stamps it on what it forwards to the
  host. The phone's `command` schema has no `slot`, so a phone-sent one fails validation and the
  message is dropped. The presenter lists "phone 1" and "phone 2" with "Drop" beside each, and
  nothing else about the phones.
- **Nothing a join code or a rider token can do grants control.** The controller routes need a
  sign-in of the host account or the current control code; the WebSocket gives the role by the
  token's prefix; commands are routed only from controller connections; a rider token is refused
  by every controller route by prefix. The control code is in no message the room window or a
  rider can receive. Guard tests hold each of these (section 7).

### 4. The contract (contract lane)

New schemas in `schema/live/v1/`, one JSON Schema per message and per HTTP body, every object
closed (`additionalProperties: false`), with generated Python and TypeScript types like the class
format. Every message has `"v": 1` and a `type`. Strings have maximum lengths; arrays have
maximum items; numbers are integers (times in milliseconds). Issues 5, 8 and 9 build only
against the merged contract.

**HTTP routes** (bodies and answers; credentials as in ADR 0002):

| Route | Caller, credential | Body | Answer |
|---|---|---|---|
| `POST /api/live/sessions` | App, device token | none | session id, join code, host token |
| `POST /api/live/controller` | Phone, site cookie | `session` | controller token |
| `POST /api/live/control` | Phone, none | `session`, `code` | controller token |

`session` is the join code, naming the session only. Refusals: `cannot_control` (controller);
`invalid_code`, `controllers_full` (control); `sessions_full` (409, sessions); a malformed body
on any of them, `invalid_request` (422). They share ADR 0002's error shape as a closed
enum, plus 429 with `Retry-After` from section 10 of ADR 0002.

**WebSocket messages.** The table is the routing allowlist for the companion; the server checks
each message against the schema for its sender's role and drops (and counts) anything else.

| Type | From → to | Holds |
|---|---|---|
| `hello` | any → server | The token (ADR 0002) |
| `welcome` | server → the connection | `role`; a controller's `slot`; whether the host is in |
| `host_status` | server → controllers | `connected`: true or false |
| `controller_joined`, `controller_left` | server → host | `slot`; `via`: `sign_in` or `code` |
| `make_code` | host → server | nothing |
| `control_code` | server → host | `code`, `expiresInMs` |
| `code_cancelled` | server → host | `reason`: `wrong_tries`, `expired`, `used`, `replaced` |
| `drop` | host → server | `slot` |
| `companion_state` | host → controllers | Below |
| `command` | controller → server | Below, without `slot` |
| `command` (forwarded) | server → host | The same, with the `slot` the server stamped |
| `command_result` | host → server | `slot`, `id`, `result`, `reason` |
| `ack` | server → the one controller in `slot` | `id`, `result`, `reason` |
| `end` | host → server | nothing |
| `ended` | server → the connection | `reason`: `host_ended`, `revoked`, `expired`, `dropped` |

**`ack` has one sender, the server**, and goes only to the controller that sent the command. It
is either the host's `command_result` passed on, or the server's own answer when it forwards
nothing (`host_away`, `rate`). `result` is `applied`, `duplicate` or `refused`; `reason` is null
or one of `stale`, `stale_run`, `invalid`, `not_allowed`, `would_stop_following`, `host_away`,
`rate`.

**`companion_state`** holds only what the teleprompter shows:

- `run`, and `seq`: an integer the host increases by 1 per state message within the run;
- `status`: `not_started`, `running`, `paused`, `holding`, `ended`; `classMs`, `lengthMs`,
  `classRemainingMs`;
- `now`: the current interval's index, `zone` (number and name), `cue`, `remainingMs`;
- `next`: up to 3 coming intervals, each with `startMs`, `lengthMs`, `zone`, `cue`;
- `nextSong`: the coming song change, `atMs` and the incoming song's `title` and `artist`, or
  null (song titles are held in memory only, for the session, like the class itself);
- `link`: `mode` (`following` or `manual`), the state name of ADR 0001, `canUndo`, and
  `announcement`: null or a `kind` from a closed enum (taken in issue 1 from the player's fixed
  texts, for example `resynced_back`, `resynced_forward`) with an integer `seconds` or null. The
  phone writes the words; no free text crosses the relay;
- `allowed`: the command actions that do something now without stopping the following of the
  music (section 5); the phone greys the rest and says why.

It holds no rider field of any kind (no count, nickname, reading or presence), no token or code,
no account or device name. It is routed to controllers only. Riders, when they come, get their
own closed `rider_state`; whether it carries the cue is decided in the riders' issues.

**`command`** has `id` (16 random bytes, base64url, new for each tap), `run` and `basis` (the
`seq` of the state the phone showed), and `action`, one of exactly:

| `action` | Player command | Note |
|---|---|---|
| `start` | `start` | |
| `pause` | `pause` | |
| `resume` | `resume` | |
| `skip` | `next` | To the next song while following, the next interval on the manual clock |
| `nudge` | `jump` | `deltaMs` exactly `5000` or `-5000` (`JUMP_MS`); never while followed |
| `undo_resync` | `undo` | Only while `canUndo`; ADR 0001's undo, back to the manual clock |

`previous`, manual, follow and picking an occurrence stay on the presenter; adding one is a
contract pull request and an amendment of ADR 0002.

**The equipment allowlist.** The action list above is the whole set of things a phone can ask.
No schema in `schema/live/` has a field or value that sets resistance, incline, brake, speed,
power, gear, level, a target on a machine, or a mode of a machine; the player has no code path
from a live message to any device other than its own clock and the music app's play, pause and
next (`core/link/transport.ts`).

### 5. Command semantics: idempotent, never late, never off the music

- **The host checks in this order**, after the server's schema check:
  1. `(slot, id)` seen in the run's last 64 commands: the first answer again, `duplicate`, and
     nothing applied. Keyed by slot as well, so one phone's ids never answer for the other's.
     This comes first so a resend after a lost `ack` gets its answer even if it is now late.
  2. `run` not the current run: `stale_run`.
  3. `basis` above the current `seq`: `invalid`.
  4. `basis` names a state published more than 3 s ago: `stale` (default, a player setting). A
     tap made on an old picture, or held up by the network, never fires late.
  5. `action` not in the current `allowed`: `not_allowed`.
  6. The route at this moment (`routeWhileFollowing`) would hand the clock over to manual (for
     example the music app cannot be sent the pause now): `would_stop_following`, and the clock
     and the link stay exactly as they were.
  7. Otherwise applied through the presenter's path: `parseClockCommand`, `routeWhileFollowing`,
     the clock or the music app. A phone can do nothing the presenter cannot.
- **A phone command never stops the following of the music, with one exception.** `allowed` is
  computed from the same routing: while following, an action whose route is a handover (`nudge`
  always; `pause`, `resume` and `skip` when the music app cannot be sent them) is left out, and
  step 6 catches a change between the state and the tap. The exception is `undo_resync`: ADR
  0001 defines it as the return to the manual clock at the earlier place, and the phone then
  shows "manual clock". Following again is chosen on the presenter.
- The phone shows `would_stop_following` and `not_allowed` as "Not while following the music:
  use the computer", and the other refusals as "Too late, try again" or "Not connected".
- An applied phone command shows a short line on the presenter ("phone 1: pause").
- The phone shows a pressed button as pending until its `ack` or a later state; it never queues a
  command while disconnected (the buttons are disabled then) and never retries a command with a
  new `id` by itself.
- **Message budget.** ADR 0002 lets a connection send 10 messages a second and closes it beyond.
  The server lets each controller send at most 2 commands a second and answers more with `ack`
  `rate` itself, so at most 4 commands a second reach the host. The host sends `companion_state`
  on a change, coalesced to at most 4 a second, at least once a second and at once on
  `controller_joined`; `command_result`s
  go first; the host's own sender holds its total under 8 a second. Controller traffic can
  never get the host's connection closed.

### 6. Failure behaviour

- **Nothing on the companion's path can stop or change the class.** The clock, the music link
  and the room screen run without the session; a drop only takes the phone away.
- **Host connection drops:** the app reconnects with its host token in memory, backing off 1, 2,
  4, 8 then 15 s, for the 15 minutes ADR 0002 keeps the session. On `welcome` it sends a fresh
  `companion_state` at once. The presenter shows "phone remote: reconnecting".
- **Phone drops:** the page shows "reconnecting", disables the buttons and keeps counting down
  from the last state for 10 s, marked as not live; after that it shows "not connected" and no
  countdown. It reconnects with the token from `sessionStorage` and shows nothing until the next
  `companion_state`; a state with a lower `seq` in the same run is ignored.
- **Live process restarted or backend down:** the sessions are gone (memory only). The host's
  reconnect is refused; the app shows "phone remote ended", offers a new session and the class
  goes on. The phone shows "ended".
- **The phone's page or browser is closed or the screen sleeps:** the page asks for a screen
  wake lock while shown; without one it says so. Closing the tab loses the token; the instructor
  gets control again by sign-in or a new control code.
- The live process never invents state: a controller sees `host_status` false and nothing else
  while the host is away.

### 7. Guards (tests in CI)

- **Rule guard, contract lane:** the `command` schema's `action` enum equals the table in section
  4 exactly and `deltaMs` equals ±`JUMP_MS`; every live schema is closed; no property name or
  enum value in `schema/live/` contains, as a whole word (names split at `_`, `-` and case
  changes), a word from `schema/live/guard/equipment-words.txt` (resistance, incline, brake,
  speed, power, gear, level, erg, target, slope, watts, and the like). The issue and the test
  name that one file. A change to the expected action list is a rule-sensitive pull request.
- **Rule guard, rider data:** `companion_state` has no whole word from
  `schema/live/guard/rider-words.txt` (nickname, reading, rider, presence, count), and the
  server's router sends it only to controller connections.
- **Backend:** routing is the allowlist (anything else dropped and counted); commands are
  accepted only from controller connections and a `slot` from a phone fails validation; the
  control code goes only to the host; rider and host tokens are refused by the controller
  routes; the third controller's answers; the per-controller command limit; deleting the
  account and revoking the device end the session (with and without the notification).
- **Player:** the live command intake returns a `ClockCommand` or nothing (a type test and a
  table test of every `action`); a table test over every link state, `canSend` true and false,
  and every action shows that no phone command except `undo_resync` changes the link's mode,
  that `allowed` never lists an action whose route is a handover, and that a refused command
  leaves the clock and link unchanged; the check order of section 5; the control code is sent
  only on the presenter's channel, never on the room window's (`room-preload`); the host's
  send budget; a dropped connection leaves the clock state unchanged.

### 8. Security-critical parts (top-tier Developer and Reviewer)

The SQL functions `auth_device_active` and `auth_session_active` and the `pg_notify` calls in
the revoking transactions; the live process's sessions, host token and re-check with its own
listening connection; the WebSocket `hello`, `Origin` check, limits and router; the controller
routes (the cookie route, control codes and their counting, controller tokens, dropping); the
app's host-token handling and command intake; the phone page's token handling (fragment,
`sessionStorage`, content security policy). The contract and its guards are rule-sensitive and
define who may control a class (top-tier Reviewer). The phone's and presenter's layouts are not
security-critical; they get a design review.

### 9. Issue outline for the companion (contract first)

Each item: lane, scope, dependencies, and whether it is security-critical (S) or
rule-sensitive (R).

1. **contract**: `schema/live/v1`: the HTTP bodies and answers and every WebSocket message of
   section 4, generated types, the guard word files and the rule guards of section 7. Depends on
   this ADR. S, R.
2. **backend**: implement `auth_device_active` and `auth_session_active`; `pg_notify` on device
   revocation, "sign out everywhere" and account deletion. The lifetimes they use stay constants
   in the function bodies (ADR 0002 principle 7); any advisory lock goes in `lock_registry.py`.
   Depends on this ADR. S.
3. **backend**: live sessions in memory: `POST /api/live/sessions`, the host token, one per
   device, 3 per account, lifetimes, `end`, the re-check loop and its listener, audit events;
   account deletion ends sessions. Depends on 1 and 2. S.
4. **backend**: the WebSocket: `hello`, `Origin`, limits, the router on the schemas, slots,
   `host_status`, `controller_joined` and `controller_left`, `ack` with `host_away` and `rate`.
   Depends on 1 and 3. S.
5. **backend**: controller routes and host operations: by sign-in, control codes (`make_code`,
   `control_code`, exchange, counting, `code_cancelled`), at most 2 controllers and the third's
   answers, `drop`. Depends on 1 and 4. S.
6. **docs**: the Designer's spec of the companion page and the presenter's phone-remote panel.
   Depends on this ADR. Design review.
7. **player**: pure modules: `companion_state` from the snapshot with `allowed`; the command
   intake (check order, ids, run, basis, `would_stop_following`, mapping to `ClockCommand`);
   the send budget; against fakes. Depends on 1. S, R.
8. **player**: the live client in the main process: start and end the session, host token in
   memory, reconnect, host operations; the presenter panel (control code, slots, Drop, the
   "phone 1: pause" line). Depends on 1, 6 and 7, built against the contract and a fake relay.
   S, R.
9. **screens**: the companion page in `web/`: both ways in, token handling, interpolation, the
   stale and ended states, buttons with pending and `ack`, the refusal texts, wake lock; against
   recorded messages. Depends on 1 and 6. S.

Then the Verifier runs the companion's "done when" on fakes: app, backend and a headless phone
page, with a fake music link. Issues 1, 2 and 6 start together; then 3, 7 and 9; then 4 and 8;
then 5. That keeps within two open pull requests per lane.

### 10. Amends ADR 0002 sections 8 and 13

ADR 0002 lets a controller send start, pause, skip and nudge, and the plan's companion text names
the same buttons. This ADR adds two actions and drops none; the plan's button list is extended by
this amendment. ADR 0002's roles table, routing table and "guessed control code" threat row are
edited in the same pull request (marked "amended 2026-11-13, ADR 0005"), and its routing table
points to section 4 here for the companion's messages.

- **`resume`:** a pause the phone cannot end would leave the class stopped until the instructor
  gets off the bike, so pause without resume strands the class.
- **`undo_resync`:** plan section 4 and ADR 0001 put the one-touch undo of an announced resync
  "on the instructor's screen and the companion". It is the one phone action that stops the
  following of the music, by ADR 0001's definition of the undo.

What a guessed or stolen controller token can do grows by these two: resume a paused class and
undo a resync while one is announced. Neither changes an interval, reaches a rider or a device,
or outlasts the session; the host can drop the controller.

This ADR also refines four points ADR 0002 left open, without changing its rules: a right code
while both places are held is `controllers_full` and not a wrong try (section 3); the server, not
the phone, gives the `slot` (section 3); each controller may send at most 2 commands a second,
answered `rate` beyond that (section 4); and the host asks for, and is told about, control codes
by WebSocket messages (`make_code`, `control_code`, `code_cancelled`, section 4). It adds one
way a control code ends, the host's `drop` (section 3), marked in ADR 0002's token table.

## Alternatives

- **Local network (a server in the app, the phone on the same Wi-Fi):** lower latency and no
  backend, but it needs an inbound port and a firewall prompt on the studio computer, fails on
  Wi-Fi with client isolation and on mobile data, needs discovery or a typed address, and puts a
  listening service and its own TLS into the hardened Electron shell. Rejected.
- **Server-sent events plus HTTP posts for commands:** works, but two channels to authenticate
  and limit where ADR 0002 already has one WebSocket. Rejected.
- **Bluetooth between phone and computer:** not a web page on iPhone without Bluefy, and close to
  the sensor work of PL9. Rejected.
- **The relay as the clock's owner** (the backend runs the class): the class would depend on
  the network, against ADR 0001. Rejected.
- **One long session per app run across classes:** fewer codes to type, but the riders' join
  code would outlive the class it names. Kept as a later option behind the session interface.
- **Free nudge steps or a "seek to" command:** more power on a phone on a moving bike for little
  gain; the fixed ±5 s matches the presenter. A seek would be a contract change.
- **Letting a phone command hand the clock over to manual** (as the presenter's do): the phone
  could stop following with one tap and could not start it again. Rejected; only the undo does.
- **`previous` on the phone:** replays intervals on purpose, a rare act better done at the
  computer, and while following it hands the clock over. Left on the presenter.
- **Optimistic updates on the phone:** faster feel, but the phone could show a state the player
  is not in. Rejected; a pending mark instead.

## Consequences

- Studio networks need nothing but outbound HTTPS; the companion works on mobile data too.
- The companion needs the backend and a paired app. Without them the class still runs from the
  presenter and the keyboard.
- A live-process restart ends every session; the instructor starts a new one. Acceptable while
  sessions run in one process (plan section 5).
- The phone sees the class state about a tenth to a third of a second late. Taps that arrive
  late are refused rather than applied.
- The command set is small and closed. Each new control is a contract pull request with the rule
  guard changed in plain sight.
- Watch: relay latency on studio Wi-Fi against the 3 s `stale` default; whether instructors want
  the session to span classes; whether two controllers are ever used.
