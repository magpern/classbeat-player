// The page the sensor panel's screenshot test loads: the real panel on a FakeSensorSource the test drives
// from outside, a clock the test sets, and no shell bridge at all (a call to `window.player` would
// fail the page). Bundled by the test into a temp folder; never part of dist/.
import { mountRiders } from "../../src/renderer/riders-panel.ts";
import type { RidersApi } from "../../src/renderer/riders-panel.ts";
import { mountSensors } from "../../src/renderer/sensors-panel.ts";
import { FakeSensorSource } from "../unit/fake-sensor-source.ts";

const fake = new FakeSensorSource();
let clock = 10_000;
const sensors = mountSensors(fake, () => clock);
Object.assign(window, { __fake: fake, __setNow: (t: number) => void (clock = t), __sensors: sensors });

// The riders panel beside it, on a stand-in bridge that serves the view the test sets, so the test can
// check that the two drawers open one at a time. (No `window.player` is defined: the panels never call it.)
const none = (): Promise<null> => Promise.resolve(null);
const riders: RidersApi = {
  riders: () => Promise.resolve((window as unknown as { __riders?: never }).__riders ?? null),
  dropRider: none,
  lockJoining: none,
  newJoinCode: none,
  startLive: none,
};
mountRiders(riders);
