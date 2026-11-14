// The website's entry (docs/design/site.md). One script from this site's own origin: no inline
// script, no eval, nothing from another origin (ADR 0002, section 5).
import "../design/tokens.css";
import "./site.css";
import "./classes.css";
import { start } from "./app.ts";

start();
