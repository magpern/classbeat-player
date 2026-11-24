// The page the sensor panel's screenshot test loads: the real panel on a FakeSensorSource the test drives
// from outside, a clock the test sets, and no shell bridge at all (a call to `window.player` would
// fail the page). Bundled by the test into a temp folder; never part of dist/.
import { mountSensors } from "../../src/renderer/sensors-panel.ts";
import { FakeSensorSource } from "../unit/fake-sensor-source.ts";

const fake = new FakeSensorSource();
let clock = 10_000;
const sensors = mountSensors(fake, () => clock);
Object.assign(window, { __fake: fake, __setNow: (t: number) => void (clock = t), __sensors: sensors });
