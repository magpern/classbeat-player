// The scan behind the "no Bluetooth in a shipped player bundle" guard (ADR 0012, section 5). It reads
// the text a bundle ships, never the sources, so a module reached through any import path is covered.
// Two parts: a ban list (the browser's Bluetooth entry, every write call, native Bluetooth classes,
// every named control point and equipment-control word) and an allowlist (a GATT number in the
// assigned-number range or a Bluetooth-base UUID is allowed only if ADR 0012, section 1, names it).

/** ADR 0012, section 1: the services and characteristics read by notification, and nothing else. */
export const ALLOWED_GATT: ReadonlySet<number> = new Set([0x180d, 0x1816, 0x1818, 0x1826, 0x2a37, 0x2a5b, 0x2a63, 0x2ad2]);

const BANNED: readonly [string, RegExp][] = [
  ["navigator.bluetooth", /\bbluetooth\b/i],
  ["requestDevice", /\brequestDevice\b|\brequestLEScan\b/],
  ["a GATT write call", /\bwriteValue\w*|\bwriteCharacteristic\w*|\bwriteDescriptor\w*|\bBluetoothGatt\w*|\bBluetoothRemoteGATT\w*/],
  ["a GATT connection", /\bgatt\b|\bgetPrimaryService\w*|\bstartNotifications\b/i],
  ["a control point", /control[\s_-]?point|\b0x2ad9\b|\b0x2a55\b|\b0x2a66\b|\b(?:10969|10837|10854)\b/i],
  ["an equipment-control opcode", /\b(?:setTargetPower|setTargetResistance|setTargetInclination|setIndoorBikeSimulation|requestControl|startOrResume|stopOrPause|setTargetSpeed|spinDownControl)\b/i],
];

// 16-bit numbers assigned to GATT services (0x1800-0x27ff) and characteristics (0x2a00-0x2bff).
const GATT_HEX = /\b0x(1[89a-f][0-9a-f]{2}|2[0-7][0-9a-f]{2}|2[ab][0-9a-f]{2})\b/gi;
const BASE_UUID = /\b0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb\b/gi;

/** What a bundle's text must not contain; one line per finding. */
export function bluetoothFindings(file: string, text: string): string[] {
  const out: string[] = [];
  for (const [label, re] of BANNED) if (re.test(text)) out.push(`${file}: ${label}`);
  for (const m of text.matchAll(GATT_HEX)) if (!ALLOWED_GATT.has(parseInt(m[1]!, 16))) out.push(`${file}: GATT number ${m[0]} is not on ADR 0012's list`);
  for (const m of text.matchAll(BASE_UUID)) if (!ALLOWED_GATT.has(parseInt(m[1]!, 16))) out.push(`${file}: UUID ${m[0]} is not on ADR 0012's list`);
  return out;
}

/** The source modules a build reports (its metafile inputs) that name Bluetooth by file. */
export function bluetoothModules(inputs: readonly string[]): string[] {
  return inputs.filter((f) => /bluetooth/i.test(f)).map((f) => `${f}: a Bluetooth module is in the bundle`);
}
