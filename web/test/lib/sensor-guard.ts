// The sensor guard (ADR 0012, section 1; rule 2), as an allowlist that fails closed: in web/src only
// the four allowed services and characteristics may be named, in any spelling, there is no write
// call and no control point by name, and the word "bluetooth" appears in one file only
// (BLUETOOTH_ALLOWED, pinned by its test).
const ALLOWED = new Set([0x180d, 0x1816, 0x1818, 0x1826, 0x2a37, 0x2a5b, 0x2a63, 0x2ad2]);
/** The one file that may name the browser's sensor API, relative to web/. */
export const BLUETOOTH_ALLOWED: readonly string[] = ["src/sensors/web-bluetooth.ts"];

// The 16-bit assigned ranges of services (0x18xx) and characteristics (0x2Axx, 0x2Bxx).
const inGattRange = (n: number): boolean => (n >= 0x1800 && n <= 0x18ff) || (n >= 0x2a00 && n <= 0x2bff);
const BASE = "-0000-1000-8000-00805f9b34fb";

/** Is this 32-bit value a 16-bit assigned number on the allowlist (the top half zero)? */
const allowed32 = (n: number): boolean => n >>> 16 === 0 && ALLOWED.has(n & 0xffff);

function uuidProblems(src: string): string[] {
  const bad: string[] = [];
  // Every 128-bit UUID, with or without dashes: only the base form of an allowed number. A vendor's
  // own UUID (a trainer's private control service, a UART) is never on the list.
  for (const m of src.matchAll(/(?<![0-9a-f])([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})(?![0-9a-f])/gi)) {
    const tail = `-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase();
    if (tail !== BASE || !allowed32(parseInt(m[1]!, 16))) bad.push(m[0]);
  }
  // Hex literals of four digits or more, any digit count and separators (0x2AD9, 0x02ad9, 0x2a_d9).
  for (const m of src.matchAll(/\b0x([0-9a-f][0-9a-f_]*)\b/gi)) {
    const digits = m[1]!.replace(/_/g, "");
    if (digits.length < 4) continue;
    if (digits.replace(/^0+/, "").length > 8 || !allowed32(parseInt(digits, 16))) bad.push(m[0]);
  }
  // Short strings: "2ad9", "00002ad9". Letters make it a UUID; digits only count in the GATT ranges.
  for (const m of src.matchAll(/["'`]([0-9a-f]{4}|0000[0-9a-f]{4})["'`]/gi)) {
    const n = parseInt(m[1]!, 16);
    if (!ALLOWED.has(n) && (inGattRange(n) || /[a-f]/i.test(m[1]!))) bad.push(m[0]);
  }
  // Decimals in any file, with or without separators (10969 or 10_969 for 0x2ad9): every number in
  // the GATT ranges that is not on the allowlist fails, as on main. A file that needs such a value
  // writes it another way (a sum, a product), so the guard never has to guess what a number means.
  for (const m of src.matchAll(/(?<![\w.#-])(\d[\d_]*)(?![\w.%])/g)) {
    const n = Number(m[1]!.replace(/_/g, ""));
    if (inGattRange(n) && !ALLOWED.has(n)) bad.push(m[0]);
  }
  return bad;
}

export const RULES: ReadonlyArray<{ name: string; test: (src: string) => boolean }> = [
  { name: "write call", test: (s) => /\bwriteValue(WithResponse|WithoutResponse)?\b/.test(s) },
  { name: "control-point UUID", test: (s) => /control[\s_-]*point/i.test(s) || uuidProblems(s).length > 0 },
  { name: "bluetooth", test: (s) => /bluetooth/i.test(s) },
];

/** The rules a source breaks. `file` is its path relative to web/, for the one bluetooth allowance. */
export function violations(src: string, file = ""): string[] {
  const exempt = BLUETOOTH_ALLOWED.includes(file.replace(/\\/g, "/"));
  return RULES.filter((r) => !(exempt && r.name === "bluetooth") && r.test(src)).map((r) => r.name);
}
