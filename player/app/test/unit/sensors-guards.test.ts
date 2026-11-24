// The panel's own guards (#664; docs/design/sensors.md, "Guards the build adds"): readings are shown,
// never stored or sent; the core is pure; nothing in player/ names a Bluetooth API or a write.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REPO } from "./fixtures.ts";

const APP = join(REPO, "player", "app");
const ts = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? ts(join(dir, n)) : n.endsWith(".ts") ? [join(dir, n)] : []));
const core = ts(join(APP, "src", "core", "sensors"));
const renderer = readdirSync(join(APP, "src", "renderer")).filter((n) => n.startsWith("sensors-")).map((n) => join(APP, "src", "renderer", n));
const code = (p: string): string => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("sensor code", () => {
  it("finds its files", () => {
    assert.ok(core.length >= 9 && renderer.length === 2);
  });
  it("stores and sends nothing, and never calls the shell's bridge", () => {
    const bad = /localStorage|sessionStorage|indexedDB|document\.cookie|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|postMessage|ipcRenderer|window\.player|\bplayer\.|console\.|BroadcastChannel|\bcaches\b/;
    assert.deepEqual([...core, ...renderer].filter((p) => bad.test(code(p))).map((p) => p.slice(APP.length)), []);
  });
  it("the pure core imports no I/O and touches no window or document", () => {
    const bad = /from\s+["'](node:|electron)|\bdocument\b|\bwindow\b|\bprocess\b|\bnavigator\b/;
    assert.deepEqual(core.filter((p) => bad.test(code(p))).map((p) => p.slice(APP.length)), []);
  });
  it("no sensor module sets, writes or names a control point (rule 2), and none is a long file", () => {
    for (const p of [...core, ...renderer]) {
      assert.doesNotMatch(code(p), /writeValue|writeCharacteristic|ControlPoint|control_point|0x2ad9|0x2a55|0x2a66|\bsetResistance|\bsetSpeed/i, p);
      assert.ok(readFileSync(p, "utf8").split("\n").length <= 300, p);
    }
  });
  it("nothing in player/ names navigator.bluetooth", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === "dist" ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const hits = walk(join(REPO, "player")).filter((p) => /\.(ts|js|mjs|html|kt|json)$/.test(p) && !p.endsWith("rules.test.ts") && !p.endsWith("sensors-guards.test.ts") && !p.endsWith("room-controls.test.ts") && /navigator\s*(\?\.|\.|\[)\s*["']?bluetooth/.test(readFileSync(p, "utf8")));
    assert.deepEqual(hits.map((p) => p.slice(REPO.length)), []);
  });
});
