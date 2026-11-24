# 0012. Sensors: reading Bluetooth heart rate, cadence and power

Status: Proposed. Becomes Accepted when a Reviewer passes its pull request. Sections 5 and 6
wait for the owner (docs/owner.md) and are built on stand-ins until then.

## Context

Plan phase PL9 reads Bluetooth sensors: first the instructor's own bike and heart rate on the
computer, shown against the target; then each rider's phone reads the rider's own bike or strap,
shows it to that rider against their own target and sends it to the instructor's screen only
(plan section 7, rule 13). Riders use the web page: Android in Chrome, iPhone in Bluefy.

The product rules that bind sensors (plan section 3): rule 2, the product never controls
equipment (nothing sets resistance, speed, incline or a brake; connecting and switching on
measurement notifications are allowed and needed, AGENTS.md section 6); rule 5, sensor values
are numbers and gauges against the target, never movement through a scene; rule 7, colour is the
planned zone, never a measured heart-rate zone; rule 8, no "adjust by your heart rate"; rule 11,
intensity is never changed from performance; rule 13, rider data flows one way, from the rider
to the instructor.

Two rule guards stand in the way of parts of PL9, and agents do not loosen a guard:

- `player/app/test/unit/rules.test.ts` bans `navigator.bluetooth` (and every `writeValue`) in
  all the desktop player's code, so the player cannot open a sensor.
- `schema/live/guard/equipment-words.txt` bans `power`, `cadence`, `rpm` and `ftms` in every
  live-session schema, so a rider's reading cannot be put in a live message.

These guards also stay as they are: the play bundle's ban on `navigator.bluetooth`
(`web/test/unit/play-banned-apis.test.ts`, ADR 0008 section 6), the room sources' ban on
`writeValue` and `navigator.bluetooth` (`player/app/test/unit/room-controls.test.ts`), and the
Kotlin ban on `BluetoothGatt` and `writeCharacteristic` in `player/mobile/` (ADR 0011 section 8).

## Decision

### 1. Standard services only, read only

Only these Bluetooth services and characteristics are named anywhere in sensor code:

| Service | Characteristic read by notification |
|---|---|
| Heart Rate (0x180D) | Heart Rate Measurement (0x2A37) |
| Cycling Speed and Cadence (0x1816) | CSC Measurement (0x2A5B) |
| Cycling Power (0x1818) | Cycling Power Measurement (0x2A63) |
| Fitness Machine (0x1826) | Indoor Bike Data (0x2AD2) |

Running Speed and Cadence and Treadmill Data come with PL10, in the same way. Sensor code only
asks for a device with these services, gets these characteristics and starts their
notifications. It never writes a characteristic, never names a control point (Fitness Machine
Control Point 0x2AD9, SC Control Point 0x2A55, Cycling Power Control Point 0x2A66) and never
asks for any other service. (In a browser, `startNotifications` makes the browser itself write
the Client Characteristic Configuration descriptor; our code writes nothing. The native Android
case, ADR 0011 section 7, allows that one descriptor write and no other.) A new guard test in each lane that reads sensors pins this as an
allowlist of UUIDs and a ban on every write call.

### 2. A pure core shared by both sides

The parsing of each characteristic's bytes into numbers (heart rate in bpm; cadence in rpm,
from crank revolutions where the device gives no cadence; power in watts) is a pure module in
`web/src/sensors/core/`, with no Bluetooth or other I/O, tested table-driven against recorded
byte fixtures. The rider page uses it, and the desktop renderer may import it as it already
imports the room screen. A reading is held for at most 3 s; after that the value shows as
missing, never as the last number.

### 3. A sensor source behind an interface, with fakes

Every screen reads from a `SensorSource` (connect on a user's tap, readings, disconnect, state:
unsupported, idle, choosing, connected, lost). Tests, CI and the screenshot harness use a fake
that replays recorded fixtures; nothing in CI touches Bluetooth.

### 4. Readings are shown, never stored or acted on

A reading is shown as a number, and as a gauge against the interval's target where the target
has the same unit (cadence against the cadence target; power against the rider's own FTP share;
heart rate against the maximum heart rate share). Colour stays the planned zone. No reading
changes the class, its timing or a target (rules 5, 7, 8, 11), and no reading reaches the music
link: music is never chosen, stretched or shifted from a measured cadence (rule 3). Readings live in memory only:
nothing is saved, synced or logged. "Actual against planned" (plan section 2) is later work with
its own ADR.

### 5. The rider page reads the rider's own sensors (built now)

The rider page (`web/src/rider/`) gets a "Connect a sensor" control. Only one file,
`web/src/sensors/web-bluetooth.ts`, may name `navigator.bluetooth`, and only with the allowlist
of section 1; a new web guard pins that and bans every write call in all of `web/src/`. The
rider page takes its `SensorSource` from its entry point: the web rider page's entry passes the
Web Bluetooth source, and every other entry passes an "unavailable" source. Where the
browser has no Web Bluetooth, the page says so, and on an iPhone names Bluefy (plan section 7).
The rider's readings stay on the rider's phone: in this ADR nothing is sent to the session. No
player bundle contains `web-bluetooth.ts` or any `navigator.bluetooth`: a test builds every
shipped player bundle, the desktop renderer's and each of `player/mobile/`'s entry points
(`main`, `rider`, `instructor`), and checks its module list and output, as
`web/test/unit/play-banned-apis.test.ts` does for the play bundle. The app's rider mode
(`player/mobile/src/rider.ts`) therefore passes the "unavailable" source, and its riders read
sensors from the web page until the native reader of section 6 exists. So no code reaches a
player's banned API through the web lane, directly or through another module.

### 6. Waiting for the owner, on stand-ins

- **The instructor's sensors on the computer.** Proposal, like #173: `navigator.bluetooth` is
  allowed in one renderer file, with the allowlist of section 1 and no write; the main process
  answers Electron's `select-bluetooth-device` with the app's own chooser, for the app's own
  window only, refuses Bluetooth pairing requests, and keeps every other permission refused.
  Until the owner decides, the player has the instructor's sensor panel on a stand-in source that
  reports "unavailable".
- **Riders' readings to the instructor.** Proposal: one live message, `rider_reading`, sent by a
  rider and delivered to the host only (`routing.json`), carrying heart rate, cadence and power as
  bounded whole numbers, at most once a second (the server drops and counts faster ones, keeps no
  copy and logs no value). The equipment-word guard keeps applying to every other schema, the
  rider-bound and controller-bound guards stay as they are, and a test pins the one exception.
  The host shows readings in the presenter window only, never on the room screen, in join order,
  with no ranking, sorting by value, grid of rider circles, bar per rider against a target line,
or colour by value (rules 6 and 13); with one
  display they are not shown. Until the owner decides, nothing is sent.
- **The phone app's native sensors** (PL12, plan section 7) need the Kotlin guard's
  `BluetoothGatt` ban lifted for one file; that is proposed with the instructor's case above and
  built after it.

## Alternatives

- Reading sensors in the desktop player's main process with a native Bluetooth library: more
  code, a native helper to harden, and no reuse for the rider page.
- Proprietary bike protocols (Keiser M3i broadcast and others): out, plan section 7.
- Keeping the last reading on screen after a sensor drops: it would show a number that is no
  longer true.

## Consequences

- PL9 is "done on fakes" for the rider page; the instructor's panel exists and shows
  "unavailable" until the owner's decision, and riders' readings reach no one else.
- Each studio bike model still has to be tried with real hardware (owner task).
- PL10 adds the running services to the same allowlist and parsers.
