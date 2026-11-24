// Replays the recorded notifications of web/fixtures/sensors (hand-built bytes of the four allowed
// characteristics) through the real parsers into a fake source. No Bluetooth, no network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCyclingPower, parseHeartRate, parseIndoorBike } from "../../../../web/src/sensors/core/index.ts";
import { replay } from "../../../../web/src/sensors/fake-replay.ts";
import type { Recorded } from "../../../../web/src/sensors/fake-replay.ts";
import type { FakeSensorSource } from "./fake-sensor-source.ts";
import { REPO } from "./fixtures.ts";

export const FIXTURE = JSON.parse(readFileSync(join(REPO, "web", "fixtures", "sensors", "notifications.json"), "utf8")) as Record<string, Recorded[]>;

/** Plays one recorded characteristic into one device, `base` ms after the source's zero; returns the last time. */
export function replayInto(fake: FakeSensorSource, id: string, kind: "heartRate" | "cyclingPower" | "indoorBike", base: number): number {
  return replay(FIXTURE[kind]!, (view, t) => {
    const at = base + t;
    if (kind === "heartRate") fake.read(id, "heartRate", parseHeartRate(view)!.bpm, at);
    if (kind === "cyclingPower") fake.read(id, "power", parseCyclingPower(view)!.watts, at);
    if (kind === "indoorBike") {
      const b = parseIndoorBike(view)!;
      if (b.cadence !== undefined) fake.read(id, "cadence", b.cadence, at);
      if (b.watts !== undefined) fake.read(id, "power", b.watts, at);
    }
  });
}
