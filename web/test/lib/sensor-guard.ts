// The patterns of the sensor guard (ADR 0012, section 1; rule 2): what may appear nowhere in web/src.
export const RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "write call", re: /\bwriteValue(WithResponse|WithoutResponse)?\b/ },
  // Fitness Machine, SC and Cycling Power control points, as 0x2AD9, "2ad9" or inside a 128-bit UUID.
  { name: "control-point UUID", re: /(?<![0-9a-f])(2ad9|2a55|2a66)(?![0-9a-f])|0000(2ad9|2a55|2a66)-0000/i },
  { name: "navigator.bluetooth", re: /navigator\s*(\?\.|\.|\[\s*["'`])\s*bluetooth/ },
];

export function violations(src: string): string[] {
  return RULES.filter((r) => r.re.test(src)).map((r) => r.name);
}
