// Small checks the wire parsers share: closed objects, the contract's id pattern, integer ranges.
// Pure: no DOM, no I/O.

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Every own key is one of `allowed`, and every key of `required` is there. */
export const closed = (v: Obj, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));

export const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const strMax = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;

export const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === "string" && (values as readonly string[]).includes(v);

/** 16 bytes in base64url without padding: `id` and `run` (schema/live/README.md, choice 3). */
export const ID22 = /^[A-Za-z0-9_-]{22}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID22.test(v);

export const MAX_SAFE = 9007199254740991;
export const DAY_MS = 86_400_000;

/** A message's head: `"v": 1` and the given `type`. */
export const head = (v: Obj, type: string): boolean => v.v === 1 && v.type === type;
