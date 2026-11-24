// The sensor guard (ADR 0012, section 1; rule 2), as an allowlist that fails closed: in web/src only
// the four allowed services and characteristics may be named, in any spelling, there is no write
// call, no control point by name, and the word "bluetooth" does not appear at all (the rider page's
// one-file exception comes with its issue).
const ALLOWED = new Set([0x180d, 0x1816, 0x1818, 0x1826, 0x2a37, 0x2a5b, 0x2a63, 0x2ad2]);
// The 16-bit assigned ranges of services (0x18xx) and characteristics (0x2Axx, 0x2Bxx).
const inGattRange = (n: number): boolean => (n >= 0x1800 && n <= 0x18ff) || (n >= 0x2a00 && n <= 0x2bff);

function uuidProblems(src: string): string[] {
  const bad: string[] = [];
  const check = (n: number, spelled: string, letters: boolean): void => {
    if (!ALLOWED.has(n) && (inGattRange(n) || letters)) bad.push(spelled);
  };
  // 0x2AD9, 0x00002ad9 (any digit count from 4 to 8)
  for (const m of src.matchAll(/\b0x([0-9a-f]{8}|[0-9a-f]{4})\b/gi)) check(parseInt(m[1]!, 16) & 0xffff, m[0], true);
  // "00002ad9-0000-1000-8000-00805f9b34fb" and the short 4-digit string "2ad9"
  for (const m of src.matchAll(/(?<![0-9a-f])0000([0-9a-f]{4})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) check(parseInt(m[1]!, 16), m[0], true);
  for (const m of src.matchAll(/["'`]([0-9a-f]{4})["'`]/gi)) check(parseInt(m[1]!, 16), m[0], /[a-f]/i.test(m[1]!));
  // decimals, such as 10969 for 0x2ad9
  for (const m of src.matchAll(/(?<![\w.#-])(\d{4,5})(?![\w.%])/g)) check(Number(m[1]), m[0], false);
  return bad;
}

export const RULES: ReadonlyArray<{ name: string; test: (src: string) => boolean }> = [
  { name: "write call", test: (s) => /\bwriteValue(WithResponse|WithoutResponse)?\b/.test(s) },
  { name: "control-point UUID", test: (s) => /control[\s_-]*point/i.test(s) || uuidProblems(s).length > 0 },
  { name: "bluetooth", test: (s) => /bluetooth/i.test(s) },
];

export function violations(src: string): string[] {
  return RULES.filter((r) => r.test(src)).map((r) => r.name);
}
