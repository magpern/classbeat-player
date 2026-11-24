// Rider mode's page, rider.html (docs/design/app-modes.md, app-rider-join.md): the join in two steps,
// the class, and the mode strip on step 1. Only the RiderMode plugin is on the bridge while this
// page shows; native code holds the rider token and the page never sees it (issue #633).
import "../../../web/src/design/tokens.css";
import "../../../web/src/companion/companion.css";
import "../../../web/src/rider/rider.css";
import "../../../web/src/rider/sensors.css";
import "./modes/app.css";
import { riderMode } from "./modes/bridge.ts";
import { RiderModeApp } from "./rider/app.ts";
import { unavailableSource } from "../../../web/src/sensors/source.ts";

new RiderModeApp(riderMode(), document.body, unavailableSource());
