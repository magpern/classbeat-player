# 0015. Running classes and treadmill reading

Status: Proposed. Becomes Accepted when a Reviewer passes its pull request. Testing on a real
treadmill waits for the owner (docs/owner.md); until then everything is built and tested on fakes.

## Context

Plan phase PL10 is "Running classes and treadmill reading". The plan's section 7 says reading a
treadmill's speed and incline "is the same work" as reading a bike, and that controlling a
treadmill is out of scope for safety.

The class format already describes running classes. `class.sport` is `cycling` or `running`
(`schema/class-format/v1/class.schema.json`). A running interval must have `incline` (`flat` or
`raised`) and must not have `cadence`, `position`, `pattern` or `test`. The player already shows
"Running" in the class list (`player/app/src/core/list/screen.ts`) and the incline as a text
target (`player/app/src/core/format.ts`). No screen has been checked against a running class, and
nothing reads a treadmill.

The product rules that bind this work (plan section 3):
- rule 1: the player only displays the class;
- rule 2: the player never controls equipment;
- rules 4 and 5: no track or world, and nothing moves at a speed or slope taken from sensor data;
- rule 7: colour means the planned zone;
- rule 13: rider data flows one way.

## Decision

### 1. No change to the class format

Running classes use the existing v1 format. The player reads `sport` and shows each interval's
zone, name, cue and incline. It shows no cadence or position target, because a running interval
has none. If the format later needs a numeric incline or pace, that is a contract-lane change
with its own ADR.

### 2. Every screen shows a running class, specified first

The Designer adds a running-class state to the room screen, the plain screen, the phone page and
the app's screens in `docs/design/`:
- the zone as a number, a name and a colour;
- the incline target as text ("Incline raised"), readable at room distance;
- no cadence gauge, and no seated or standing cue.

The scene keeps its light-only look for running. Nothing in it moves with speed or incline
(rules 4 and 5), and a test pins that the scene's inputs are the same for a running class as for
a cycling one. The screens are built against that spec with screenshots of each state.

### 3. Treadmill reading: notifications only

The sensor core (`web/src/sensors/core/`, shared with the player as in ADR 0012 section 2) gains
pure decoders for two sources:
- FTMS **Treadmill Data** (characteristic 0x2ACD, in the Fitness Machine service 0x1826 already
  allowed): instantaneous speed and inclination, honouring the flags field. Other fields are
  skipped by their flag and never decoded into a value; total distance in particular is never
  shown (rule 4).
- **Running Speed and Cadence** (service 0x1814, measurement characteristic 0x2A53), for foot
  pods: instantaneous speed and cadence.

The fail-closed allowlist of ADR 0012 section 1 grows by exactly these three numbers and no
other: 0x1814, 0x2A53 and 0x2ACD, added to `ALLOWED` in `web/test/lib/sensor-guard.ts` and to
`SERVICES` and `CHARACTERISTICS` in `web/src/sensors/core/uuids.ts`, with the guard's own test
updated to pin the new list. The Fitness Machine Control Point (0x2AD9), the RSC Control Point
(0x2A55) and every other control point stay off the list, so naming one still fails the guard,
as does any characteristic write. As for a bike, the code only connects, subscribes to
notifications and decodes. No rule is removed from the guard and no existing check is loosened.

### 4. Readings are shown, never acted on

Speed (km/h, or the pace derived from it), incline (%) and a foot pod's cadence (steps a minute)
are shown as numbers only. The class's incline is `flat` or `raised`, not a number, so there is
no gauge against it. Colour stays the planned zone; a reading never colours anything (rule 7).
A reading older than 3 s is shown as missing, never as the last number (`freshness.ts`, as for a
bike). A reading never changes the class, its timing, the scene or the music (rules 1, 3, 5), and
it lives in memory only, as in ADR 0012 section 4.

### 5. Where it runs

The treadmill reading follows ADR 0012's gating exactly; this ADR opens nothing new.
- **Built now: the rider page.** As in ADR 0012 section 5, the web rider page reads the rider's
  own treadmill or foot pod through `web-bluetooth.ts` and shows it to that rider only. Nothing
  is sent to the session.
- **Waiting for the owner: the instructor's computer and the app's rider mode.** These are ADR
  0012 section 6 cases. Until the owner decides, both keep their "unavailable" source. The
  owner's proposal (1) names the heart-rate, cycling and fitness-machine services; it is amended
  in `docs/owner.md` to add the RSC service (0x1814) for foot pods, the only addition.
- **Waiting for the owner: riders' readings to the instructor.** The proposed `rider_reading`
  carries heart rate, cadence and power only. Sending treadmill speed or incline would need a
  contract change and an amended owner proposal (rule 13); neither is made here, so no running
  reading leaves the rider's phone.

### 6. Fakes

Recorded Treadmill Data and RSC notifications are added to `web/fixtures/sensors/`, and a fake
treadmill source replays them. Nothing in CI touches Bluetooth.

## How the work splits

1. design: running-class states for every screen, and the treadmill and foot-pod readings on the
   rider page (Designer, spec and mock-ups).
2. sensors core: the Treadmill Data and RSC decoders, fixtures, and the three allowlist
   additions with the guard test. Rule-sensitive.
3. screens: the room screen, plain screen and phone page show a running class, and the rider
   page shows treadmill and foot-pod readings (after 1 and 2).
4. player: the scene-input test for running (after 1). The instructor's sensor panel and the
   app's rider mode stay on "unavailable" until the owner's decision (ADR 0012 section 6).
5. Verifier: PL10 on fakes.

## Alternatives

- **A numeric incline or pace in the class format now.** Rejected: classbeat sends only
  `flat`/`raised`, and a contract change without a producer for it adds risk for no gain.
- **Controlling the treadmill's speed or incline to follow the class.** Not allowed by rule 2
  and the plan's safety note.
- **A separate running scene with a track.** Not allowed by rules 4 and 5.

## Consequences

- PL10 can be finished on fakes. A live check waits for a treadmill (owner.md).
- Treadmills vary as bikes do. Some may expose only a proprietary service and cannot be read.
- The rule guard covers one more device type, so a future treadmill control would fail CI.
