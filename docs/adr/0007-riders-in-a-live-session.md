# 0007. Riders in a live session

Status: Proposed

## Context

PL8's second part (plan section 12): riders join by code and their phone shows their own view
in step with the room. The handlebar companion (ADR 0005) is built on the same live session.
Sensor readings from riders' phones are PL9; the player as a web app on a phone or tablet is the
last part of PL8 and gets its own ADR.

What this ADR takes as given:

- Rule 13: rider data flows one way, from the rider to the instructor. No ranked list, no
  comparison of riders, no other riders' data on a rider's phone. Rule 14: the join code names
  the session only and never gives control.
- [ADR 0002](0002-accounts-sign-in-pairing-and-tokens.md) section 8 already decides the rider's
  credentials and limits: `POST /api/live/join` with the join code and a nickname, the rider
  token `cbp_rdr_` in `sessionStorage`, `https://<site>/j#<code>`, the one answer `cannot_join`,
  1 to 24 characters for a nickname, 60 riders connected, a token dropped after 5 minutes without
  a connection, the join limits of section 10, the routing rules for riders ("no path from a
  rider to a rider", "a rider receives no roster, no rider count, no nickname and no reading of
  anyone else", "the function that sends to riders accepts only those host-to-rider types"),
  and that nothing about riders is written to the database or to logs. This ADR keeps all of it.
- [ADR 0005](0005-live-sessions-and-the-handlebar-companion.md): the transport (through the
  backend, outbound only), the run of a session, `run` and `seq`, the WebSocket `hello`, the rule
  guards and their word files in `schema/live/guard/`. It left to the riders' issues "whether
  `rider_state` carries the cue".
- [ADR 0003](0003-class-format.md): each zone of `zone_scale` has a number, a name and optional
  ranges `ftp_pct`, `hrmax_pct` and `rpe`; an interval has a zone, a `position` and an optional
  `test`.
- The equipment-word guard (ADR 0005 section 7) holds for every live schema, so no rider message
  can carry a field named for cadence, power or a target.

## Decision

### 1. What a rider gets, and what stays on the phone

- The rider's phone shows the current interval (zone as number, name and colour; position; an
  FTP test label), its time left, the class time left, the next three intervals, and the effort
  for the zone worked out **on the phone** from the rider's own FTP or maximum heart rate.
- **FTP and maximum heart rate never leave the phone.** They are typed on the rider page and kept
  in that page's memory. A "Remember on this phone" switch, off by default, keeps them in the
  page's `localStorage`, with a "Forget" button next to it. No message and no HTTP body in the
  contract has a field for them.
- **`rider_state` carries no cue and no song.** The cue is the instructor's teleprompter text
  (ADR 0005) and the room screen already shows the music; leaving both out keeps free text off up
  to 60 phones. *Default, reversible:* adding either is a contract pull request.
- In PL8 a rider sends nothing after joining: its only WebSocket message is `hello`. Readings
  come in PL9, in their own contract pull request.

### 2. The contract (contract lane, `schema/live/v1`)

HTTP: `POST /api/live/join`, no credential, body `session` (the join code) and `nickname`,
answer the rider token. Errors: `invalid_request`, `body_too_large`, `cannot_join`,
`too_many_requests`, `internal_error`. The body schema is closed and has exactly those two
fields.

WebSocket, added to the routing allowlist:

| Type | From → to | Holds |
|---|---|---|
| `welcome` (amended) | server → rider | `role` `rider`, `hostConnected` |
| `host_status` (amended) | server → riders | `connected` |
| `rider_state` | host → riders | Below |
| `rider_joined` | server → host | `rider`, `nickname` |
| `rider_left` | server → host | `rider`, `reason`: `left`, `idle`, `dropped`, `replaced` |
| `drop_rider` | host → server | `rider` |
| `lock` | host → server | `locked`: true or false |
| `lock_state` | server → host | `locked` |
| `new_join_code` | host → server | nothing |
| `join_code` | server → host | `code` |
| `ended` (amended) | server → rider | `reason`, as today (`dropped` when the host removed the rider) |

`rider` is an id the server gives each rider token: 8 random bytes, base64url, never derived
from the token or the nickname. `rider_left` with `left` is a closed connection whose token may
still come back within 5 minutes; `idle` is the 5-minute drop; `replaced` is a second connection
with the same token.

**`rider_state`** holds only:

- `run`, `seq` (as `companion_state`, its own counter);
- `status`, `classMs`, `lengthMs`, `classRemainingMs`;
- `now`: `index`, `zone`, `position` or null, `test` (`kind`, `minutes`) or null, `remainingMs`;
- `next`: up to 3 coming intervals, each `startMs`, `lengthMs`, `zone`, `position`;
- each `zone` is `number`, `name` and `effort`: `ftpPct`, `hrmaxPct` and `rpe`, each
  `[low, high]` or null, copied from the class's `zone_scale`.

It holds nothing derived from any rider, no token or code, no account, device or instructor
name, no cue, no song and no link state. It is the same message for every rider: the host sends
it once and the server sends those bytes to every rider connection.

### 3. Lock, new code and removing a rider

- **Lock** (`lock` with `true`): every join is answered `cannot_join`; riders already in stay.
  Unlocking lets joins in again. The host is told the state in `lock_state`. A session starts
  unlocked.
- **New join code** (`new_join_code`): the server makes a new code, answers `join_code` to the
  host only, and from then on the old code finds nothing, for joins and for the controller routes
  of ADR 0005. Riders and controllers already in stay. The app shows the new code and its QR code
  on the room screen at once.
- **Remove** (`drop_rider`): the rider's token is dropped, its connection is closed with 4403
  after `ended` `dropped`, and the host gets `rider_left` `dropped`. The phone says "The
  instructor removed you from this class" and offers no rejoin button; scanning again works
  unless the session is locked or the code is new.

### 4. Where riders appear in the app

- **The presenter window only.** It shows the number of riders in and their nicknames, in the
  order they joined, with Remove, Lock and New code. Never the room window, never the companion
  (ADR 0002), never a ranked or sorted-by-anything-else list.
- The list lives in the app's memory for the session and is cleared when the session ends. It is
  never written to disk, the class history or a log, and nicknames are rendered as text only.

### 5. The rider page (screens lane)

- Served by the backend at `/j` like `/control`: the same headers (content security policy,
  `no-store`, `Referrer-Policy: no-referrer`), the join code read from the fragment only.
- States: enter nickname (and optionally FTP and maximum heart rate); joining; in the class;
  waiting for the instructor (`hostConnected` false); not joined (`cannot_join`, one text for
  every cause: "Could not join. Check the code with your instructor."); removed; ended.
- The view interpolates `remainingMs` and `classRemainingMs` with the phone's monotonic clock
  between messages and stops interpolating while waiting for the instructor. It asks for a wake
  lock while in the class.
- The effort is worked out by a pure module (`effort_calc`): watts from `ftpPct` and FTP, beats
  per minute from `hrmaxPct` and maximum heart rate, rounded to whole numbers; without either
  value it shows the percentages and the RPE.
- A rider token lost (the tab closed, 5 minutes away) means joining again with the code from the
  address.

### 6. Guards (tests in CI)

- **Contract:** every new schema is closed; `rider_state` and every other message the routing
  table delivers to a rider have no whole word from a new file
  `schema/live/guard/rider-bound-words.txt` (the words of `rider-words.txt` that name another
  rider's data: nickname, reading, presence, count, roster, rank and the like; not `rider`,
  `ftp` or `hr`, which `welcome` and `effort` need) and none from `credential-words.txt`; the
  join body has exactly `session` and `nickname`; the routing table lets a rider send `hello`
  only; nothing is routed from a rider to a rider or a controller.
- **Backend:** the sender to riders accepts only the rider-bound types and sends one `rider_state`
  unchanged to every rider; a rider message other than `hello` is dropped and counted; a rider
  token is refused by every controller route and by every host operation; `cannot_join` for an
  unknown code, a locked session, a full session and an old code alike, with the same body;
  the 60th and 61st rider; the 5-minute drop; no nickname in any log line or audit event.
- **Player:** the `rider_state` builder takes the snapshot and the class only, so it has no
  rider input (a type test), and its output never contains a nickname or rider id (a table
  test); the rider list reaches the presenter's channel only, never `room-preload`.
- **Screens:** `effort_calc` table tests; no request body or message from the page holds FTP or
  maximum heart rate (a test over the recorded messages and the join body); the page keeps
  nothing in `localStorage` while "Remember" is off.

### 7. Security-critical and rule-sensitive parts

Security-critical (top-tier Developer and Reviewer): the join route, rider tokens, places, the
5-minute drop and the join limits; the WebSocket rider role and the sender to riders; lock, new
code and remove; the rider page's token handling and headers. Rule-sensitive (top-tier
Reviewer): the contract and its guards, the `rider_state` builder, the presenter's rider list.
The rider page's and presenter panel's layouts get a design review.

### 8. Issue outline (contract first)

1. **contract**: the join route, the messages of section 2, the routing table, generated types,
   `rider-bound-words.txt` and the contract guards of section 6. S, R.
2. **backend**: `POST /api/live/join`, rider tokens and ids, places, the 5-minute drop, lock and
   new code as session operations, the join limits. Depends on 1. S.
3. **backend**: serve the rider page at `/j` with the companion page's headers. Depends on 1. S.
4. **docs**: the Designer's spec of the rider page and the presenter's riders panel. Depends on
   this ADR. Design review.
5. **player**: the pure `rider_state` builder and its publish policy (on every change of status or
   interval, otherwise every 2 s, at most 2 a second). Depends on 1. R.
6. **screens**: the rider page in `web/`: join, the states of section 5, `effort_calc`, the
   remembered values, interpolation, wake lock; against recorded messages. Depends on 1 and 4. S.
7. **backend**: the WebSocket rider role: `hello`, `welcome`, `host_status`, the sender to
   riders, `rider_joined`, `rider_left`, `drop_rider`, `lock`, `lock_state`, `new_join_code`,
   `join_code`, `ended`. Depends on 1 and 2. S.
8. **player**: the live client's rider side: publish `rider_state`, the presenter's riders panel
   (count, nicknames, Remove, Lock, New code), the new code on the room screen. Depends on 1, 4,
   5 and 7's contract. S, R.

Then the Verifier runs the riders' "done when" on fakes: the app, the backend and two headless
rider pages and a companion page, with a fake music link: both riders see the same interval and
time within 1 s of the room, neither sees anything of the other, and the instructor sees both.
Issues 1 and 4 start together; then 2, 3, 5 and 6; then 7 and 8.

### 9. Refines ADR 0002 section 8

Without changing its rules: ADR 0002's routing row "Session ended, removed, locked → the
connection concerned" becomes `ended` to the rider removed and `lock_state` to the host only; a
rider trying to join a locked session learns only `cannot_join`. ADR 0002's roles table names
"lock and end the session; drop riders" for the host; this ADR adds "make a new join code",
which its token table already lists ("the host can lock the session or make a new code"). ADR
0002's lines are marked "amended, ADR 0007" in the same pull request.

## Alternatives

- **Send the cue to riders.** Riders would read coaching text meant for the instructor, and free
  text would reach up to 60 phones. Kept out by default; a later contract pull request can add it.
- **Each rider's own `rider_state`, with their effort in watts.** Needs the rider's FTP on the
  host or the server, against plan section 7 ("kept on the phone"), and makes per-rider messages
  that a guard can no longer hold identical. Rejected.
- **Riders shown on the room screen (a count or names).** Rule 13 and ADR 0002 keep riders' data
  to the instructor's view. Rejected.
- **A lock that also drops riders in.** Remove exists for that; a lock that empties the class is
  easy to hit by mistake. Rejected.

## Consequences

- Riders need nothing but the code: no account, no install, no stored data about them anywhere
  but their own phone.
- The relay's per-rider cost is one copy of one message, so 60 riders cost little.
- A rider sees no cue and no song on the phone; if riders ask for it, it is a contract change.
- Removing a rider is only as strong as the join code: a removed rider can scan again until the
  host locks or makes a new code. The presenter says so next to Remove.
- PL9's readings add a rider-to-host message and the host's view of them; this ADR's guards
  (nothing from a rider reaches a rider or a controller) must hold unchanged then.
