// The panel's own guards (#664; docs/design/sensors.md, "Guards the build adds"): readings are shown,
// never stored or sent; the core is pure; nothing in player/ names a Bluetooth API or a write.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REPO } from "./fixtures.ts";
import { type Check, forbids, type Mutation, mutationGaps, oldView, slashCode } from "./rule-sources.ts";

const APP = join(REPO, "player", "app");
const ts = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? ts(join(dir, n)) : n.endsWith(".ts") ? [join(dir, n)] : []));
const core = ts(join(APP, "src", "core", "sensors"));
const renderer = readdirSync(join(APP, "src", "renderer")).filter((n) => n.startsWith("sensors-")).map((n) => join(APP, "src", "renderer", n));
const text = (p: string): string => readFileSync(p, "utf8");
// Each check reads the code in two views (rule-sources.ts, issue #861): `slashCode`, as before, and
// the file with only its real comments out, so a "//" in a string hides nothing from it.
const STORES = "stores or sends";
const IMPURE = "the core does I/O";
const CONTROL = "names a control point";
const checks = new Map<string, Check>([
  [STORES, forbids(/localStorage|sessionStorage|indexedDB|document\.cookie|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|postMessage|ipcRenderer|window\.player|\bplayer\.|console\.|BroadcastChannel|\bcaches\b/, slashCode)],
  [IMPURE, forbids(/from\s+["'](node:|electron)|\bdocument\b|\bwindow\b|\bprocess\b|\bnavigator\b/, slashCode)],
  [CONTROL, forbids(/writeValue|writeCharacteristic|ControlPoint|control_point|0x2ad9|0x2a55|0x2a66|\bsetResistance|\bsetSpeed/i, slashCode)],
]);
const hits = (check: string, files: string[]): string[] => files.filter((p) => checks.get(check)!(p, text(p))).map((p) => p.slice(APP.length));

describe("sensor code", () => {
  it("finds its files", () => {
    assert.ok(core.length >= 9 && renderer.length === 2);
  });
  it("stores and sends nothing, and never calls the shell's bridge", () => {
    assert.deepEqual(hits(STORES, [...core, ...renderer]), []);
  });
  it("the pure core imports no I/O and touches no window or document", () => {
    assert.deepEqual(hits(IMPURE, core), []);
  });
  it("no sensor module sets, writes or names a control point (rule 2), and none is a long file", () => {
    assert.deepEqual(hits(CONTROL, [...core, ...renderer]), []);
    for (const p of [...core, ...renderer]) assert.ok(text(p).split("\n").length <= 300, p);
  });
  it('each check catches code a "//" in a string hides from the old view (issue #861)', () => {
    const CORE = join(APP, "src", "core", "sensors", "gauge-calc.ts");
    const DRAW = join(APP, "src", "renderer", "sensors-draw.ts");
    const G = "export const GAUGE_H = 12;";
    const C = "export function gaugeTrack(plan: readonly [number, number]): readonly [number, number] {";
    const hide = (anchor: string, after: string): string => `${anchor} const s = "//"; ${after}`;
    const table: readonly Mutation[] = [
      [STORES, CORE, C, hide(C, "localStorage.setItem(k, v);"), true],
      [STORES, DRAW, G, hide(G, 'fetch("/x");'), true],
      [IMPURE, CORE, C, hide(C, "navigator.usb;"), true],
      [CONTROL, CORE, C, hide(C, "c.writeValue(b);"), true],
      [CONTROL, DRAW, G, hide(G, "const p = 0x2ad9;"), true],
    ];
    assert.deepEqual(mutationGaps(table, checks, text, oldView(slashCode)), []);
    assert.deepEqual([...new Set(table.map(([c]) => c))].sort(), [...checks.keys()].sort());
  });
  it("nothing in player/ names navigator.bluetooth", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === "dist" ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const hits = walk(join(REPO, "player")).filter((p) => /\.(ts|js|mjs|html|kt|json)$/.test(p) && !p.endsWith("rules.test.ts") && !p.endsWith("sensors-guards.test.ts") && !p.endsWith("room-controls.test.ts") && /navigator\s*(\?\.|\.|\[)\s*["']?bluetooth/.test(readFileSync(p, "utf8")));
    assert.deepEqual(hits.map((p) => p.slice(REPO.length)), []);
  });
});
