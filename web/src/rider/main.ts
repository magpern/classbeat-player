// The rider page's entry, served at /j (docs/design/rider.md). The class code stays in the
// fragment (`/j#<code>`): the browser never sends a fragment to a server.
import "../design/tokens.css";
import "../companion/companion.css";
import "./rider.css";
import "./sensors.css";
// The browser's sensor source, by the package's import map: only this entry names it, so the
// native app's bundles, which take the unavailable source, never carry it (ADR 0012).
import { browserSensors } from "#browser-sensors";
import { RiderApp } from "./app.ts";

new RiderApp(document.body, browserSensors());
