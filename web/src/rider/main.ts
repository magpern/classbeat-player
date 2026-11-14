// The rider page's entry, served at /j (docs/design/rider.md). The class code stays in the
// fragment (`/j#<code>`): the browser never sends a fragment to a server.
import "../design/tokens.css";
import "../companion/companion.css";
import "./rider.css";
import { RiderApp } from "./app.ts";

new RiderApp(document.body);
