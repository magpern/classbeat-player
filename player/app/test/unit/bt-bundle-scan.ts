// The scan behind the "no Bluetooth in a shipped player bundle" guard (ADR 0012, section 5). It reads
// a build as esbuild reports it: the module list (metafile inputs), the text each output ships, and the
// source of each of our own modules. Ban list on the output (any "bluetooth", every write call, every
// named control point and equipment-control word). Allowlists: a Bluetooth-base UUID in the output and
// a GATT number in a source must be one ADR 0012, section 1, names (esbuild prints 0x2a39 as 10809 in
// the output, so numbers are read from the sources, where it is still hex); a Capacitor plugin
// registered in the output must be one of the app's two modes.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** ADR 0012, section 1: the services and characteristics read by notification, and nothing else. */
export const ALLOWED_GATT: ReadonlySet<number> = new Set([0x180d, 0x1816, 0x1818, 0x1826, 0x2a37, 0x2a5b, 0x2a63, 0x2ad2]);

const BANNED: readonly [string, RegExp][] = [
  ["Bluetooth (the word, in any case, inside any name)", /bluetooth/i],
  ["requestDevice", /\brequestDevice\b|\brequestLEScan\b/],
  ["a GATT write call", /\bwriteValue\w*|\bwriteCharacteristic\w*|\bwriteDescriptor\w*|\bBluetoothGatt\w*|\bBluetoothRemoteGATT\w*/],
  ["a GATT connection", /\bgatt\b|\bgetPrimaryService\w*|\bstartNotifications\b/i],
  ["a control point", /control[\s_-]?point|\b0x2ad9\b|\b0x2a55\b|\b0x2a66\b|\b(?:10969|10837|10854)\b/i],
  ["an equipment-control opcode", /\b(?:setTargetPower|setTargetResistance|setTargetInclination|setIndoorBikeSimulation|requestControl|startOrResume|stopOrPause|setTargetSpeed|spinDownControl)\b/i],
];

// 16-bit numbers assigned to GATT services (0x1800-0x18ff) and characteristics (0x2a00-0x2bff).
const GATT_HEX = /\b0x(18[0-9a-f]{2}|2[ab][0-9a-f]{2})\b/gi;
const BASE_UUID = /\b0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb\b/gi;

/** The Capacitor plugins a phone bundle registers: its two modes and the three Capacitor's core brings. */
export const ALLOWED_PLUGINS: ReadonlySet<string> = new Set(["RiderMode", "InstructorMode", "CapacitorCookies", "CapacitorHttp", "SystemBars"]);
const PLUGIN = /\bregisterPlugin\s*(?:<[^>()]*>)?\(\s*["'`]([^"'`]*)["'`]/g;

/** A GATT number in source text that ADR 0012 does not list. */
export function gattNumberFindings(file: string, text: string): string[] {
  return [...text.matchAll(GATT_HEX)].filter((m) => !ALLOWED_GATT.has(parseInt(m[1]!, 16))).map((m) => `${file}: GATT number ${m[0]} is not on ADR 0012's list`);
}

/** What a bundle's text must not contain; one line per finding. */
export function bluetoothFindings(file: string, text: string): string[] {
  const out: string[] = [];
  for (const [label, re] of BANNED) if (re.test(text)) out.push(`${file}: ${label}`);
  out.push(...gattNumberFindings(file, text));
  for (const m of text.matchAll(PLUGIN)) if (!ALLOWED_PLUGINS.has(m[1]!)) out.push(`${file}: plugin "${m[1]}" is not on the allowed list`);
  for (const m of text.matchAll(BASE_UUID)) if (!ALLOWED_GATT.has(parseInt(m[1]!, 16))) out.push(`${file}: UUID ${m[0]} is not on ADR 0012's list`);
  return out;
}

/** The source modules a build reports (its metafile inputs) that name Bluetooth by file. */
export function bluetoothModules(inputs: readonly string[]): string[] {
  return inputs.filter((f) => /bluetooth/i.test(f)).map((f) => `${f}: a Bluetooth module is in the bundle`);
}

/** What esbuild's build result (metafile on, write off) holds, as the scan reads it. */
export interface BuildResult {
  outputFiles?: { path: string; text: string }[];
  metafile: { inputs: Record<string, unknown> };
}

/** Every finding of one build: its module list, each output's text and each own source's numbers. */
export function buildFindings(result: BuildResult, root: string): string[] {
  const inputs = Object.keys(result.metafile.inputs);
  const out = bluetoothModules(inputs);
  for (const f of result.outputFiles ?? []) if (/\.(?:js|cjs|css|html)$/.test(f.path)) out.push(...bluetoothFindings(f.path.split(/[\\/]/).pop()!, f.text));
  for (const i of inputs) if (/\.[cm]?[jt]s$/.test(i) && !i.includes("node_modules")) out.push(...gattNumberFindings(i, readFileSync(join(root, i), "utf8")));
  return out;
}
