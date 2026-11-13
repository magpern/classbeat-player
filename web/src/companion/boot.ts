// Runs first, before any other code of the page (main.ts imports it first; companion.md, "Page
// hardening"): the fragment is read once and removed from the address bar at once, with the query
// if there is one, so neither a code nor anything else lingers in the address, the history or a
// later request. The fragment is never sent anywhere by the browser; the codes it carries go
// only into the page's memory.
import { parseFragment } from "./core/codes.ts";
import type { Fragment } from "./core/codes.ts";

function takeFragment(): Fragment {
  const hash = location.hash;
  if (hash !== "" || location.search !== "") history.replaceState(null, "", location.pathname);
  return parseFragment(hash);
}

export const fragment: Fragment = takeFragment();
