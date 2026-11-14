// The record and the tools the site trap (site-instrument.ts) is built from. Playwright serialises
// `trapKit` into the page as source text ahead of the trap, so it is self-contained: it imports
// nothing and calls nothing from this module.
//
// Page code cannot blind the trap (#315):
// - The record lives in this closure. `globalThis.__traps` is a frozen, non-writable and
//   non-configurable reader that returns a copy as JSON text, so the page holds no reference to
//   what is recorded and cannot empty, replace or edit it.
// - Every built-in called once the page runs is captured here at install and called directly
//   (`Reflect.apply`), never through a prototype: a page that replaces `RegExp.prototype.test`,
//   `String.prototype.toLowerCase` or `Array.prototype.push` changes no verdict.
// - No array or object the trap writes to inherits from a prototype the page can reach with a
//   setter: the record has a null prototype and arguments are converted in place.

export type Note = (kind: string, detail: unknown) => void;
type Fn = (this: unknown, ...a: unknown[]) => unknown;

export interface Kit {
  readonly apply: typeof Reflect.apply;
  readonly construct: typeof Reflect.construct;
  readonly own: typeof Object.getOwnPropertyDescriptor;
  readonly define: typeof Object.defineProperty;
  /** The captured `String`. */
  readonly S: (v: unknown) => string;
  readonly note: Note;
  /** A value converted to a string once, the way a DOMString argument is. */
  readonly str: (v: unknown) => string;
  /** Converts the arguments at `i` and `j` of `a` once, in place; a missing one stays missing. */
  readonly strAt: (a: unknown[], i: number, j?: number) => unknown[];
  readonly lower: (s: string) => string;
  /** An attribute name as checked: lower case, without a namespace prefix. */
  readonly bare: (name: string) => string;
  readonly starts: (s: string, prefix: string) => boolean;
  /** The values `a` joined by spaces, each made a string by `f`. */
  readonly words: (a: unknown[], f: (x: unknown) => string) => string;
  /** Whether an address is a `javascript:` one, read as the URL parser reads it. */
  readonly jsUrl: (s: string) => boolean;
  readonly wrapWith: (owner: object, name: string, label: string, check: (self: unknown, a: unknown[]) => unknown[]) => void;
  readonly wrap: (owner: object, name: string, label: string, before: (self: unknown, a: unknown[]) => void) => void;
  readonly onGet: (proto: object, prop: string, label: string, before: (self: unknown) => void) => void;
  readonly onSetWith: (proto: object, prop: string, label: string, check: (self: unknown, v: unknown) => unknown) => void;
  readonly onSet: (proto: object, prop: string, label: string, before: (self: unknown, v: unknown) => void) => void;
}

export function trapKit(): Kit {
  const { apply, construct } = Reflect;
  const { create, defineProperty: define, freeze, getOwnPropertyDescriptor: own } = Object;
  const [S, TypeErr, quote, exec] = [String, TypeError, JSON.stringify, RegExp.prototype.exec];
  const { charCodeAt, indexOf, slice, startsWith, toLowerCase } = String.prototype;
  const record = create(null) as Record<number, [string, string]>;
  let count = 0;
  const note: Note = (kind, detail) => {
    record[count] = [kind, S(detail)];
    count += 1;
  };
  /** The record as JSON text, built from its strings with the captured built-ins only. */
  const read = (): string => {
    let out = "";
    for (let i = 0; i < count; i += 1) out += `${i ? "," : ""}{"kind":${quote(record[i][0])},"detail":${quote(record[i][1])}}`;
    return `[${out}]`;
  };
  define(globalThis, "__traps", { value: freeze(read), writable: false, configurable: false, enumerable: false });
  const lower = (s: string): string => apply(toLowerCase, s, []) as string;
  const starts = (s: string, prefix: string): boolean => apply(startsWith, s, [prefix]) as boolean;
  const bare = (name: string): string => {
    const l = lower(name);
    const colon = apply(indexOf, l, [":"]) as number;
    return colon < 0 ? l : (apply(slice, l, [colon + 1]) as string);
  };
  /** Whether `re` matches `s`, through the captured native exec: the page's `test` or `exec` is not used. */
  const matches = (re: RegExp, s: string): boolean => apply(exec, re, [s]) !== null;
  const words = (a: unknown[], f: (x: unknown) => string): string => {
    let out = "";
    for (let i = 0; i < a.length; i += 1) out += (i ? " " : "") + f(a[i]);
    return out;
  };
  // Every route that checks a value converts it once with `str` and passes that same string on, so
  // an object whose toString answers differently on a second call is written as it was checked (#312).
  const str = (v: unknown): string => {
    if (typeof v === "symbol") throw new TypeErr("Cannot convert a Symbol value to a string");
    return S(v);
  };
  const strAt = (a: unknown[], i: number, j = -1): unknown[] => {
    if (i < a.length) a[i] = str(a[i]);
    if (j >= 0 && j < a.length) a[j] = str(a[j]);
    return a;
  };
  // C0 controls and spaces trimmed in front, tab and newline dropped, the scheme in any case.
  const [SPACE, JS] = [/\s/, /^javascript:/i];
  const jsUrl = (s: string): boolean => {
    let i = 0;
    while (i < s.length && ((apply(charCodeAt, s, [i]) as number) <= 0x20 || matches(SPACE, s[i]))) i += 1;
    let t = "";
    for (; i < s.length; i += 1) {
      const c = apply(charCodeAt, s, [i]) as number;
      if (c !== 0x09 && c !== 0x0a && c !== 0x0d) t += s[i];
    }
    return matches(JS, t);
  };
  /** Calls `check` ahead of every call of `owner[name]`, then the original with the arguments `check` returns. */
  const wrapWith: Kit["wrapWith"] = (owner, name, label, check) => {
    const o = owner as Record<string, unknown>;
    const orig = o[name];
    if (typeof orig !== "function") return note("missing", label);
    o[name] = function (this: unknown, ...a: unknown[]) {
      return apply(orig as Fn, this, check(this, a));
    };
  };
  /** Calls `before` ahead of every call of `owner[name]`. */
  const wrap: Kit["wrap"] = (owner, name, label, before) =>
    wrapWith(owner, name, label, (self, a) => {
      before(self, a);
      return a;
    });
  /** Calls `before` ahead of every read of the accessor `proto[prop]`; writing is unchanged. */
  const onGet: Kit["onGet"] = (proto, prop, label, before) => {
    const d = own(proto, prop);
    const get = d?.get;
    if (!d || !get) return note("missing", label);
    define(proto, prop, {
      ...d,
      get(this: unknown) {
        before(this);
        return apply(get, this, []);
      },
    });
  };
  /** Calls `check` ahead of every write of the accessor `proto[prop]` and writes the value it returns. */
  const onSetWith: Kit["onSetWith"] = (proto, prop, label, check) => {
    const d = own(proto, prop);
    const set = d?.set;
    if (!d || !set) return note("missing", label);
    define(proto, prop, {
      ...d,
      set(this: unknown, v: unknown) {
        apply(set, this, [check(this, v)]);
      },
    });
  };
  /** Calls `before` ahead of every write of the accessor `proto[prop]`; reading is unchanged. */
  const onSet: Kit["onSet"] = (proto, prop, label, before) =>
    onSetWith(proto, prop, label, (self, v) => {
      before(self, v);
      return v;
    });
  return { apply, construct, own, define, S, note, str, strAt, lower, bare, starts, words, jsUrl, wrapWith, wrap, onGet, onSetWith, onSet };
}
