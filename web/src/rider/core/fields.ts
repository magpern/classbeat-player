// The page's own checks of what the rider types (docs/design/rider.md, "Fields and limits").
// Pure: no DOM, no I/O. A refused value never goes out and the field keeps what was typed.
// The two number limits are design defaults: the numbers never leave the phone, so they are not in
// the contract.
import type { MyNumbers } from "./effort-calc.ts";

export const NICKNAME_MAX = 24;
export const FTP_MIN = 50;
export const FTP_MAX = 600;
export const HRMAX_MIN = 80;
export const HRMAX_MAX = 230;

export const FIELD_WORDS = {
  code: "Codes are 8 letters",
  nickname: "Type a nickname, 1 to 24 characters.",
  ftp: "FTP is a whole number from 50 to 600.",
  hrmax: "Max heart rate is a whole number from 80 to 230.",
} as const;

/** Length in Unicode code points, as JSON Schema's `maxLength` and the server count it. */
export const codePoints = (text: string): number => [...text].length;

/** The nickname to send: trimmed at both ends, 1 to 24 code points; null when it is not. */
export function checkNickname(typed: string): string | null {
  const t = typed.trim();
  const n = codePoints(t);
  return n >= 1 && n <= NICKNAME_MAX ? t : null;
}

export type Whole = number | null | "bad";

/** A typed number: null when the field is empty, the number when it is a whole number in range, "bad" otherwise. */
export function checkWhole(typed: string, min: number, max: number): Whole {
  const t = typed.trim();
  if (t === "") return null;
  if (!/^[0-9]{1,4}$/.test(t)) return "bad";
  const n = Number(t);
  return n >= min && n <= max ? n : "bad";
}

export const checkFtp = (typed: string): Whole => checkWhole(typed, FTP_MIN, FTP_MAX);
export const checkHrmax = (typed: string): Whole => checkWhole(typed, HRMAX_MIN, HRMAX_MAX);

/** What "Remember on this phone" keeps in localStorage: the two numbers, nothing else; null: nothing to keep. */
export function rememberedText(n: MyNumbers): string | null {
  return n.ftp === null && n.hrmax === null ? null : JSON.stringify({ ftp: n.ftp, hrmax: n.hrmax });
}

const inRange = (x: unknown, min: number, max: number): x is number | null => x === null || (typeof x === "number" && Number.isInteger(x) && x >= min && x <= max);

/** The remembered numbers read back; null for anything that is not exactly what this page writes. */
export function parseRemembered(text: string | null): MyNumbers | null {
  if (text === null || text.length > 64) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== "ftp,hrmax") return null;
  if (!inRange(o.ftp, FTP_MIN, FTP_MAX) || !inRange(o.hrmax, HRMAX_MIN, HRMAX_MAX) || (o.ftp === null && o.hrmax === null)) return null;
  return { ftp: o.ftp, hrmax: o.hrmax };
}
