// The address guard (test/lib/address-guard.ts) catches every change of the address the old text
// search caught, and the ones it missed (#374): compound assignment, bracket access, aliases,
// destructuring, update operators. And it lets the page's own reads and its one in-place replace by.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addressUse } from "../lib/address-guard.ts";

const problems = (src: string): string[] => addressUse("x.ts", src).problems;

/** What the old guard's pattern caught: each of these must still be reported. */
const OLD: readonly string[] = [
  'history.pushState(null, "", "/x");',
  "window.history.pushState({}, '', u);",
  'const f = "pushState";',
  "location.hash = '#x';",
  "location.href = '/x';",
  "location.search = '?a';",
  "location = '/x';",
  "window.location.hash = x;",
  "location.assign('/x');",
  "location.replace('/x');",
  "window.location.assign('/x');",
  "document.location.href = '/x';",
];

/** What it missed: each is a change of the address, and must be reported now. */
const NEW: readonly (readonly [string, string])[] = [
  ["compound assignment", "location.hash += 'x';"],
  ["logical assignment", "location.hash ||= 'x';"],
  ["update operator", "location.search++;"],
  ["bracket name", "location['hash'] = 'x';"],
  ["bracket name, template", "location[`href`] = '/x';"],
  ["bracket call", "location['assign']('/x');"],
  ["computed name", "location['as' + 'sign']('/x');"],
  ["variable name", "const k = 'hash'; location[k] = 'x';"],
  ["bracket on window", "window['location'].hash = 'x';"],
  ["bracket on window, assigned", "window['location'] = '/x';"],
  ["alias of location", "const l = location; l.hash = 'x';"],
  ["alias of window.location", "const l = window.location; l.assign('/x');"],
  ["alias of document.location", "const l = document.location; l.href = '/x';"],
  ["alias of window", "const w = window; w.location.href = '/x';"],
  ["alias of globalThis", "const g = globalThis; g.history.pushState(1, '', '/');"],
  ["destructured method", "const { assign } = location; assign('/x');"],
  ["destructured, called later", "const { replace } = window.location; replace('/x');"],
  ["passed on", "Object.assign(location, { hash: 'x' });"],
  ["destructuring target", "[location.hash] = ['x'];"],
  ["destructuring target in an object", "({ a: location.hash } = o);"],
  ["for-in variable", "for (location.hash of ['x']) {}"],
  ["delete", "delete location.hash;"],
  ["parenthesised target", "(location.hash) = 'x';"],
  ["cast target", "(location as Location).hash = 'x';"],
  ["history alias", "const h = history; h.back();"],
  ["history alias, replaceState through it", "const h = window.history; h.replaceState(null, '', '/');"],
  ["history.go", "history.go(-1);"],
  ["history.back", "window.history.back();"],
  ["history bracket", "history['push' + 'State'](1, '', '/');"],
  ["history bracket literal", "history['pushState'](1, '', '/');"],
  ["history.state write", "history.scrollRestoration = 'manual';"],
  ["Navigation API", "navigation.navigate('/x');"],
  ["Navigation API on window", "window.navigation.navigate('/x', { history: 'replace' });"],
  ["Navigation API by bracket", "window['navigation'].navigate('/x');"],
  ["pushState on an unknown object", "foo.pushState(1, '', '/');"],
  ["History prototype", "History.prototype.pushState.call(history, 1, '', '/');"],
  ["pushState in a template", "const f = `push${'S'}tate pushState`;"],
  ["computed name on the document", "document[n].hash = 'x';"],
  ["window used as a value", "foo(window);"],
  ["window by a computed name", "window[n].assign('/x');"],
  ["optional chain", "location?.assign('/x');"],
];

/** What the page does: reads, and its one in-place replace. */
const FINE: readonly string[] = [
  "const a = location.pathname + location.hash;",
  "if (location.href !== location.origin + target) history.replaceState(null, '', target);",
  "const s = window.location.search;",
  "const same = location.hash === '#x';",
  "history.replaceState(null, '', `${location.pathname}#${code}`);",
  "const o = { location: 1, history: 2 };",
];

describe("the address guard", () => {
  it("still reports everything the text search reported", () => {
    for (const src of OLD) assert.notDeepEqual(problems(src), [], src);
  });

  it("reports what the text search missed", () => {
    for (const [label, src] of NEW) assert.notDeepEqual(problems(src), [], `${label}: ${src}`);
  });

  it("lets reads and the in-place replace by, and lists the replaceState calls", () => {
    for (const src of FINE) assert.deepEqual(problems(src), [], src);
    assert.deepEqual(addressUse("x.ts", FINE[1]).replaceStateCalls, ["history.replaceState(null, '', target)"]);
    assert.deepEqual(addressUse("x.ts", "history.back();").replaceStateCalls, []);
  });

  it("does not read a comment", () => {
    assert.deepEqual(problems("// location.hash = 'x'; history.pushState()\n/* location.assign(1) */ const a = 1;"), []);
  });
});
