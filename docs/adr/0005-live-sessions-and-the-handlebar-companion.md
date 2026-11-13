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
  limits, section 13 the threats. **This ADR does not change any of it.** It decides what 0002
  left to PL8: the transport in practice, the run of a session, the messages, the command
  semantics, failure behaviour and the issue split.
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

Exactly ADR 0002 section 8, restated so the issues can check it:

- *By sign-in.* The phone is signed in on the site with the host's account and sends the join
  code to `POST /api/live/controller`. The controller token ends with that site session.
- *By control code.* The presenter, never the room window, shows a control code and a QR code of
  `https://<site>/control#<join code>.<control code>`. 2 minutes, single use, 5 wrong tries per
  session cancel it, 30 codes per session per hour. An app with one display offers no control
  code: sign-in only.
- The phone gets a controller token `cbp_ctl_`, hashed in the live process's memory, kept on the
  phone in `sessionStorage` of the site's origin only, the fragment removed from the address bar
  at once. It ends with the session, when the host drops it, or with its site session.
- **At most 2 controllers** (a phone and a spare). Their commands reach the host in arrival
  order and the host applies each against its current state (section 5). The presenter lists
  the connected controllers as "phone 1" and "phone 2", with "Drop" beside each; the server
  stamps the slot on each forwarded command and nothing else about the phone.
- **Nothing a join code or a rider token can do grants control.** The controller routes need a
  sign-in of the host account or the current control code; the WebSocket gives the role by the
  token's prefix; commands are routed only from controller connections; a rider token is refused
  by every controller route by prefix. The control code is in no message the room window or a
  rider can receive. Guard tests hold each of these (section 7).

### 4. The messages (contract lane)

New schemas in `schema/live/v1/`, one JSON Schema per message, every object closed
(`additionalProperties: false`), with generated Python and TypeScript types like the class
format. Every message has `"v": 1` and a `type`. Strings have maximum lengths; arrays have
maximum items; numbers are integers in milliseconds.

| Type | From → to | Holds |
|---|---|---|
| `hello` | any → server | The token (ADR 0002) |
| `welcome` | server → the connection | `role`; a controller's `slot`; whether the host is in |
| `host_status` | server → controllers | `connected`: true or false |
| `controller_joined`, `controller_left` | server → host | `slot` only |
| `companion_state` | host → controllers | Below |
| `command` | controller → host | Below; the server adds `slot` |
| `ack` | host → controllers | `id`, `result`, `reason` |
| `end` | host → server | Nothing |
| `ended` | server → the connection | `reason`: `host_ended`, `revoked`, `expired`, `dropped` |

**`companion_state`** is sent by the host on every change and at least once a second, and at
once on `controller_joined`. It holds only what the teleprompter shows:

- `run`, and `seq`: an integer the host increases by 1 per state message within the run;
- `status`: `not_started`, `running`, `paused`, `holding`, `ended`; `classMs`, `lengthMs`,
  `classRemainingMs`;
- `now`: the current interval's index, `zone` (number and name), `cue`, `remainingMs`;
- `next`: up to 3 coming intervals, each with `startMs`, `lengthMs`, `zone`, `cue`;
- `nextSong`: the coming song change, `atMs` and the incoming song's `title` and `artist`, or
  null (song titles are held in memory only, for the session, like the class itself);
- `link`: `mode` (`following` or `manual`), the state name of ADR 0001, `announcement` (one of
  the player's fixed texts, at most 80 characters) and `canUndo`;
- `allowed`: the command actions that do something now (so the phone greys the rest).

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
| `previous` | `previous` | |
| `nudge` | `jump` | `deltaMs` exactly `5000` or `-5000` (`JUMP_MS`); other steps: contract |
| `undo_resync` | `undo` | Only while `canUndo` |

Manual, follow and picking an occurrence stay on the presenter in this part; adding them is a
contract pull request.

**The equipment allowlist.** The action list above is the whole set of things a phone can ask.
No schema in `schema/live/` has a field or value that sets resistance, incline, brake, speed,
power, gear, level, a target on a machine, or a mode of a machine; the player has no code path
from a live message to any device other than its own clock and the music app's play, pause and
next (`core/link/transport.ts`).

### 5. Command semantics: idempotent, never late

- The host keeps the last 64 command ids of the run. A repeated `id` gets the first `ack` again
  and is not applied twice, so a phone may resend after a lost `ack`.
- A command whose `run` is not the current run is refused `stale_run`. A command whose `basis`
  names a state the host published more than 3 s ago is refused `stale` (default, a player
  setting): a tap made on an old picture, or held up by the network, never fires late.
- An accepted command goes through the same path as the presenter's button: `parseClockCommand`,
  then `routeWhileFollowing`, then the clock or the music app. So a phone can do nothing the
  presenter cannot, and while following, pause and skip go to the music app as ADR 0001 says.
  `ack` results: `applied`, `duplicate`, `refused` with `reason` one of `stale`, `stale_run`,
  `not_allowed`, `invalid`.
- An applied phone command shows a short line on the presenter ("phone 1: pause") so anyone at
  the computer sees what happened.
- The phone shows a pressed button as pending until its `ack` or a later state; it never queues a
  command while disconnected (the buttons are disabled then) and never retries a command with a
  new `id` by itself.
- The server answers a command with `ack` `refused`, `reason` `host_away`, when no host is
  connected, and forwards nothing.

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
  enum value in `schema/live/` matches an equipment vocabulary (resistance, incline, brake,
  speed, power, gear, level, erg, target, control point). A change to the expected list is a
  rule-sensitive pull request.
- **Rule guard, rider data:** `companion_state` has no field from the rider vocabulary
  (nickname, reading, rider, presence, count), and the server's router sends it only to
  controller connections.
- **Backend:** routing is the allowlist (anything else dropped and counted); commands are
  accepted only from controller connections; rider and host tokens are refused by the
  controller routes; a schema-invalid message is dropped; deleting the account and revoking the
  device end the session (with and without the notification).
- **Player:** the live command intake returns a `ClockCommand` or nothing (a type test and a
  table test of every `action`); the control code is sent only on the presenter's channel, never
  on the room window's (`room-preload`); a dropped connection leaves the clock state unchanged.

### 8. Security-critical parts (top-tier Developer and Reviewer)

The SQL functions `auth_device_active` and `auth_session_active` and the `pg_notify` calls in
the revoking transactions; the live process's sessions, host token and re-check with its own
listening connection; the WebSocket `hello`, `Origin` check, limits and router; the controller
routes (the cookie route, control codes and their counting, controller tokens, dropping); the
app's host-token handling and command intake; the phone page's token handling (fragment,
`sessionStorage`, content security policy). The contract and its guards are rule-sensitive
(top-tier Reviewer). The phone's and presenter's layouts are not security-critical; they get a
design review.

### 9. Issue outline for the companion (contract first)

Each item: lane, scope, dependencies, and whether it is security-critical (S) or
rule-sensitive (R).

1. **contract**: `schema/live/v1` messages, generated types, the rule guards of section 7.
   Depends on this ADR. R.
2. **backend**: implement `auth_device_active` and `auth_session_active`; `pg_notify` on device
   revocation, "sign out everywhere" and account deletion. Depends on this ADR. S.
3. **backend**: live sessions in memory: start with a device token, the host token, one per
   device, 3 per account, lifetimes, `end`, the re-check loop and its listener, audit events;
   account deletion ends sessions. Depends on 2. S.
4. **backend**: the WebSocket: `hello`, `Origin`, limits, the router on the schemas,
   `host_status`, `controller_joined` and `controller_left`, `host_away`. Depends on 1 and 3. S.
5. **backend**: controller routes: by sign-in, control codes (make, exchange, counting), at most
   2 controllers, Drop. Depends on 3. S.
6. **docs**: the Designer's spec of the companion page and the presenter's phone-remote panel.
   Depends on this ADR. Design review.
7. **player**: pure modules: `companion_state` from the snapshot; the command intake (ids, run,
   basis, mapping to `ClockCommand`); against fakes. Depends on 1. R.
8. **player**: the live client in the main process: start and end the session, host token in
   memory, reconnect; the presenter panel (control code, slots, Drop, the "phone 1: pause"
   line). Depends on 4, 5, 6 and 7. S, R.
9. **screens**: the companion page in `web/`: both ways in, token handling, interpolation, the
   stale and ended states, buttons with pending and `ack`, wake lock; against recorded
   messages. Depends on 1 and 6. S.

Then the Verifier runs the companion's "done when" on fakes: app, backend and a headless phone
page, with a fake music link. Issues 2, 6 and 1 start together; 3 after 2; 4, 5 and 7 after their
inputs; 8 and 9 last. That keeps within two open pull requests per lane.

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
