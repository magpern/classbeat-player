// The web player page's entry (ADR 0008). One script from this site's own origin: no inline script,
// no eval, nothing from another origin. The stylesheets are linked in index.html (page-mode.ts).
import { start } from "./app.ts";

start();
