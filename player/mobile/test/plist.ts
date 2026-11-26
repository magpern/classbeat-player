// A reader for the XML property lists the iOS app commits (issue #894): dictionaries, arrays,
// strings, integers and booleans, which is all they hold. Anything else throws, so a test never
// passes over a value it could not read.

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

const TOKEN = /<(\/?)([A-Za-z]+)((?:\s+[A-Za-z]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;

export function readPlist(xml: string): PlistValue {
  const body = xml
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<!DOCTYPE[^>]*>/, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const tokens = [...body.matchAll(TOKEN)]
    .map((m) => ({ close: m[1] === "/", tag: m[2], attrs: m[3] ?? "", empty: m[4] === "/", text: m[5] }))
    .filter((t) => t.tag !== undefined || t.text!.trim() !== "");
  let at = 0;
  const next = () => {
    const t = tokens[at++];
    if (!t) throw new Error("the property list ends early");
    return t;
  };
  const text = (tag: string): string => {
    let t = next();
    let value = "";
    if (t.tag === undefined) {
      value = t.text!;
      t = next();
    }
    if (!t.close || t.tag !== tag) throw new Error(`<${tag}> is not closed`);
    return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  };
  const value = (): PlistValue => {
    const t = next();
    if (t.tag === undefined || t.close) throw new Error(`unexpected ${t.text ?? `</${t.tag}>`}`);
    if (t.empty && t.tag === "true") return true;
    if (t.empty && t.tag === "false") return false;
    if (t.empty && t.tag === "dict") return {};
    if (t.empty && t.tag === "array") return [];
    if (t.tag === "string") return text("string");
    if (t.tag === "integer") {
      const n = text("integer");
      if (!/^-?\d+$/.test(n)) throw new Error(`not an integer: ${n}`);
      return Number(n);
    }
    if (t.tag === "array") {
      const items: PlistValue[] = [];
      while (!(tokens[at]?.close && tokens[at]?.tag === "array")) items.push(value());
      at++;
      return items;
    }
    if (t.tag === "dict") {
      const dict: { [key: string]: PlistValue } = {};
      while (!(tokens[at]?.close && tokens[at]?.tag === "dict")) {
        const k = next();
        if (k.tag !== "key" || k.close) throw new Error("a dictionary entry has no key");
        const key = text("key");
        if (Object.hasOwn(dict, key)) throw new Error(`the key ${key} is repeated`);
        dict[key] = value();
      }
      at++;
      return dict;
    }
    throw new Error(`unsupported <${t.tag}>`);
  };
  const root = next();
  if (root.tag !== "plist" || root.close) throw new Error("not a property list");
  if (tokens.some((t) => t.attrs !== "" && t !== root)) throw new Error("only <plist> has attributes");
  const result = value();
  const end = next();
  if (!end.close || end.tag !== "plist" || at !== tokens.length) throw new Error("more than one value in the property list");
  return result;
}
