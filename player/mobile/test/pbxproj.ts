// A reader for the iOS Xcode project the guards pin (issue #894): it parses the whole project as
// the old-style property list Xcode writes, whatever its whitespace, line breaks, comments or
// quoting, and gives the build configurations, file references, groups, object kinds and script
// phases from the parsed objects. Anything it cannot parse throws, and the guards report that.

export type Value = string | Value[] | Dict;
export type Dict = { [key: string]: Value };

const isDict = (v: Value | undefined): v is Dict => typeof v === "object" && !Array.isArray(v);
const ESCAPES: Record<string, string> = { "\\": "\\", '"': '"', "'": "'", n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v" };
/** Characters of an unquoted string; anything else must be quoted. */
const BARE = /[A-Za-z0-9_$+/:.-]/;

/** Parses a project file. Throws on anything it does not read in full, a repeated key included. */
export function parsePbxproj(text: string): Dict {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`${what} at offset ${i}`);
  };
  const skip = (): void => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text.startsWith("//", i)) {
        const end = text.indexOf("\n", i);
        i = end < 0 ? text.length : end + 1;
      } else if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) fail("an unclosed comment");
        i = end + 2;
      } else return;
    }
  };
  const quoted = (): string => {
    let out = "";
    i++;
    for (;;) {
      if (i >= text.length) fail("an unclosed string");
      const c = text[i++]!;
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = text[i++] ?? fail("an escape at the end");
      const hex = /^[0-9A-Fa-f]{4}/.exec(text.slice(i));
      const oct = /^[0-7]{1,3}/.exec(text.slice(i - 1));
      if (e === "U" && hex) {
        out += String.fromCharCode(parseInt(hex[0], 16));
        i += 4;
      } else if (oct) {
        out += String.fromCharCode(parseInt(oct[0], 8));
        i += oct[0].length - 1;
      } else if (Object.hasOwn(ESCAPES, e)) out += ESCAPES[e];
      else fail(`an unknown escape \\${e}`);
    }
  };
  const string = (): string => {
    if (text[i] === '"') return quoted();
    const start = i;
    while (i < text.length && BARE.test(text[i]!) && !text.startsWith("//", i) && !text.startsWith("/*", i)) i++;
    if (i === start) fail(`an unexpected ${JSON.stringify(text[i] ?? "end")}`);
    return text.slice(start, i);
  };
  const expect = (c: string): void => {
    skip();
    if (text[i] !== c) fail(`no ${c}`);
    i++;
  };
  const value = (): Value => {
    skip();
    if (text[i] === "{") {
      i++;
      const dict: Dict = Object.create(null) as Dict;
      for (;;) {
        skip();
        if (text[i] === "}") break;
        const key = string();
        if (Object.hasOwn(dict, key)) fail(`the key ${key} is repeated`);
        expect("=");
        dict[key] = value();
        expect(";");
      }
      i++;
      return dict;
    }
    if (text[i] === "(") {
      i++;
      const items: Value[] = [];
      for (;;) {
        skip();
        if (text[i] === ")") break;
        items.push(value());
        skip();
        if (text[i] === ",") i++;
        else if (text[i] !== ")") fail("no , or )");
      }
      i++;
      return items;
    }
    return string();
  };
  const root = value();
  skip();
  if (i !== text.length) fail("text after the project");
  if (!isDict(root)) throw new Error("the project is not a dictionary");
  return root;
}

/** Decodes the body of a quoted project string, as written between its quotes. */
export const decodeString = (body: string): string => parsePbxproj(`{a = "${body}";}`)["a"] as string;

/** Every object of the project by id, each a dictionary with a string isa. */
export function projectObjects(pbxproj: string): [string, Dict][] {
  const objects = parsePbxproj(pbxproj)["objects"];
  if (!isDict(objects)) throw new Error("the project has no objects");
  return Object.entries(objects).map(([id, o]) => {
    if (!isDict(o) || typeof o["isa"] !== "string") throw new Error(`the object ${id} has no kind`);
    return [id, o];
  });
}

const str = (o: Dict, key: string): string => {
  const v = o[key];
  return typeof v === "string" ? v : "";
};

export type BuildConfig = { name: string; base: string | undefined; settings: Dict };

/** Every XCBuildConfiguration; throws unless their number is the number the raw text names. */
export function buildConfigs(pbxproj: string): BuildConfig[] {
  const configs: BuildConfig[] = [];
  for (const [id, o] of projectObjects(pbxproj)) {
    if (o["buildSettings"] !== undefined && o["isa"] !== "XCBuildConfiguration") throw new Error(`${id} has build settings`);
    if (o["isa"] !== "XCBuildConfiguration") continue;
    const settings = o["buildSettings"];
    const base = o["baseConfigurationReference"];
    if (!isDict(settings) || typeof o["name"] !== "string" || (base !== undefined && typeof base !== "string")) {
      throw new Error(`the build configuration ${id} could not be read`);
    }
    configs.push({ name: o["name"], base, settings });
  }
  const named = [...pbxproj.matchAll(/\bisa\s*=\s*"?XCBuildConfiguration"?\s*;/g)].length;
  if (configs.length !== named || named === 0) throw new Error(`${configs.length} build configurations read, ${named} named`);
  return configs;
}

/** A setting's value when it is a string, or undefined. */
export const setting = (c: BuildConfig, key: string): string | undefined => {
  const v = c.settings[key];
  return typeof v === "string" ? v : undefined;
};

/** The names of every setting a configuration sets, conditional ones ("KEY[sdk=…]") as written. */
export const settingKeys = (c: BuildConfig): string[] => Object.keys(c.settings);

export type FileRef = { id: string; type: string; sourceTree: string; path: string };

/** Every PBXFileReference. */
export const fileRefs = (pbxproj: string): FileRef[] =>
  projectObjects(pbxproj)
    .filter(([, o]) => o["isa"] === "PBXFileReference")
    .map(([id, o]) => ({ id, type: str(o, "lastKnownFileType") || str(o, "explicitFileType") || "none", sourceTree: str(o, "sourceTree"), path: str(o, "path") }));

/** Every PBXGroup as "name|path|sourceTree". */
export const groups = (pbxproj: string): string[] =>
  projectObjects(pbxproj)
    .filter(([, o]) => o["isa"] === "PBXGroup")
    .map(([, o]) => ["name", "path", "sourceTree"].map((k) => str(o, k)).join("|"));

/** The kind of every object in the project. */
export const objectKinds = (pbxproj: string): string[] => projectObjects(pbxproj).map(([, o]) => o["isa"] as string);

/** Every script phase as "shellPath|script", the script decoded. */
export const shellScripts = (pbxproj: string): string[] =>
  projectObjects(pbxproj)
    .filter(([, o]) => o["isa"] === "PBXShellScriptBuildPhase")
    .map(([, o]) => `${str(o, "shellPath")}|${str(o, "shellScript")}`);
