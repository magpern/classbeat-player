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
a pure decoder for two sources:
- FTMS **Treadmill Data** (0x2ACD): instantaneous speed, inclination and total distance, honouring
  the flags field;
- the **Running Speed and Cadence** measurement (0x2A53), for foot pods.

As for a bike, the code only connects, subscribes to notifications and decodes. It never writes
a characteristic and never names the Fitness Machine Control Point (0x2AD9) or any other control
point. The existing rule guard (ADR 0012 section 1) is extended so that it also covers the
treadmill code paths, and it must fail if a control-point UUID or a characteristic write appears.
The guard is never weakened.

### 4. Readings are shown, never acted on

Speed (km/h, or the pace derived from it) and incline (%) are shown as numbers only. The class's
incline is `flat` or `raised`, not a number, so there is no gauge against it. A reading never
changes the class, its timing, the scene or the music (rules 1, 3, 5), and it lives in memory
only, as in ADR 0012 section 4.

### 5. Where it runs

The reading runs where ADR 0012 already allows a sensor:
- on the instructor's computer, through the same `SensorSource`;
- on the rider's page and in the app's rider mode, once ADR 0012 sections 5 and 6 are unblocked
  by the owner.

A rider's treadmill reading goes to the instructor only, as any other rider reading (rule 13),
and only once the owner's `rider_reading` decision is made.

### 6. Fakes

Recorded Treadmill Data and RSC notifications are added to `web/fixtures/sensors/`, and a fake
treadmill source replays them. Nothing in CI touches Bluetooth.

## How the work splits

1. design: running-class states for every screen (Designer, spec and mock-ups).
2. sensors core: the Treadmill Data and RSC decoders, fixtures, and the extended rule guard.
   Rule-sensitive.
3. screens: the room screen, plain screen and phone page show a running class (after 1).
4. player: the sensor panel shows treadmill readings (after 2), plus the scene-input test for
   running (after 1).
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
