// A reader for the iOS Xcode project the guards pin (issue #894). It accepts only the canonical
// form Xcode writes: every line must match one of a fixed set of line shapes, keys are made of
// [A-Za-z0-9_.], a value is a bare word or path or a quoted string with no backslash, a /* */
// comment follows only an object id, and there is no // anywhere but the first line. The script
// phases are the one place with backslashes, so a script line must be one of CocoaPods' own,
// byte for byte. Any other line throws, and the guards report that the project is not canonical.
// What Apple's own reader makes of the project is checked on macOS by ios-verify (criterion 5).

export type Value = string | Value[] | Dict;
export type Dict = { [key: string]: Value };

const isDict = (v: Value | undefined): v is Dict => typeof v === "object" && !Array.isArray(v);

/** CocoaPods' own script phases, as pod install writes them between the quotes: the lock check
 * (twice) and the framework embed. */
const CHECK_LOCK =
  'diff \\"${PODS_PODFILE_DIR_PATH}/Podfile.lock\\" \\"${PODS_ROOT}/Manifest.lock\\" > /dev/null\\nif [ $? != 0 ] ; then\\n    # print error to STDERR\\n    echo \\"error: The sandbox is not in sync with the Podfile.lock. Run \'pod install\' or update your CocoaPods installation.\\" >&2\\n    exit 1\\nfi\\n# This output is used by Xcode \'outputs\' to avoid re-running this script phase.\\necho \\"SUCCESS\\" > \\"${SCRIPT_OUTPUT_FILE_0}\\"\\n';
export const SHELL_SCRIPTS = [CHECK_LOCK, CHECK_LOCK, '\\"${PODS_ROOT}/Target Support Files/Pods-App/Pods-App-frameworks.sh\\"\\n'];

const KEY = String.raw`[A-Za-z0-9_.]+`;
const ID = /^[0-9A-F]{24}$/;
/** A comment: printable ASCII without *, / or a backslash. */
const C = String.raw` /\* [ -)+-.0-\[\]-~]+ \*/`;
const BARE = String.raw`/?[A-Za-z0-9_.]+(?:/[A-Za-z0-9_.]+)*`;
/** A quoted string: printable ASCII without a quote or a backslash. */
const QUOTED = String.raw`"[ !#-\[\]-~]*"`;
const V = `${BARE}|${QUOTED}`;

const ASSIGN = new RegExp(`^(\\t*)(${KEY})(${C})? = (${V})(${C})?;$`);
const OPEN = new RegExp(`^(\\t*)(${KEY})(${C})? = ([{(])$`);
const INLINE = new RegExp(`^(\\t*)(${KEY})(${C})? = \\{((?:${KEY} = (?:${V})(?:${C})?; )+)\\};$`);
const PAIR = new RegExp(`(${KEY}) = (${V})(${C})?; `, "gy");
const ITEM = new RegExp(`^(\\t*)(${V})(${C})?,$`);
const CLOSE = /^(\t*)([})]);$/;
const SCRIPT = /^(\t*)shellScript = "(.*)";$/;
const SECTION = /^\/\* (Begin|End) ([A-Za-z]+) section \*\/$/;

const unquote = (v: string): string => (v.startsWith('"') ? v.slice(1, -1) : v);

/** Reads a project in Xcode's canonical form. Throws on the first line that is not. */
export function readPbxproj(text: string): Dict {
  const lines = text.split("\n");
  const root: Dict = Object.create(null) as Dict;
  const stack: (Dict | Value[])[] = [root];
  let section: string | undefined;
  const sectionOf = new Map<string, string>();
  const fail = (n: number, why = "is not in Xcode's canonical form"): never => {
    throw new Error(`line ${n + 1} ${why}`);
  };
  if (lines[0] !== "// !$*UTF8*$!" || lines[1] !== "{" || lines.at(-2) !== "}" || lines.at(-1) !== "") {
    throw new Error("the project does not start and end as Xcode writes it");
  }
  const commented = (n: number, word: string, comment: string | undefined): void => {
    if (comment !== undefined && !ID.test(word)) fail(n, "has a comment after something that is not an object id");
  };
  const put = (n: number, depth: number, key: string, value: Value): void => {
    const top = stack.at(-1)!;
    if (depth !== stack.length || Array.isArray(top)) fail(n);
    const dict = top as Dict;
    if (Object.hasOwn(dict, key)) fail(n, `repeats the key ${key}`);
    dict[key] = value;
    if (stack.length === 2 && stack[1] === root["objects"]) {
      if (section === undefined) fail(n, "is an object outside a section");
      sectionOf.set(key, section!);
    }
  };
  for (let n = 2; n < lines.length - 2; n++) {
    const line = lines[n]!;
    let m: RegExpExecArray | null;
    if (line === "") continue;
    if ((m = SECTION.exec(line))) {
      if (stack.length !== 2 || stack[1] !== root["objects"]) fail(n);
      if (m[1] === "Begin" ? section !== undefined : section !== m[2]) fail(n);
      section = m[1] === "Begin" ? m[2] : undefined;
    } else if ((m = SCRIPT.exec(line))) {
      if (!SHELL_SCRIPTS.includes(m[2]!)) fail(n, "is a script phase that is not one of CocoaPods' own");
      put(n, m[1]!.length, "shellScript", m[2]!);
    } else if ((m = ASSIGN.exec(line))) {
      commented(n, m[2]!, m[3]);
      commented(n, m[4]!, m[5]);
      put(n, m[1]!.length, m[2]!, unquote(m[4]!));
    } else if ((m = OPEN.exec(line))) {
      commented(n, m[2]!, m[3]);
      const value: Dict | Value[] = m[4] === "{" ? (Object.create(null) as Dict) : [];
      put(n, m[1]!.length, m[2]!, value);
      stack.push(value);
    } else if ((m = INLINE.exec(line))) {
      commented(n, m[2]!, m[3]);
      const dict: Dict = Object.create(null) as Dict;
      PAIR.lastIndex = 0;
      for (let p = PAIR.exec(m[4]!); p; p = PAIR.exec(m[4]!)) {
        commented(n, p[2]!, p[3]);
        if (Object.hasOwn(dict, p[1]!)) fail(n, `repeats the key ${p[1]}`);
        dict[p[1]!] = unquote(p[2]!);
      }
      put(n, m[1]!.length, m[2]!, dict);
    } else if ((m = ITEM.exec(line))) {
      const top = stack.at(-1)!;
      if (m[1]!.length !== stack.length || !Array.isArray(top)) fail(n);
      commented(n, m[2]!, m[3]);
      (top as Value[]).push(unquote(m[2]!));
    } else if ((m = CLOSE.exec(line))) {
      const top = stack.pop();
      if (m[1]!.length !== stack.length || stack.length === 0 || Array.isArray(top) !== (m[2] === ")")) fail(n);
    } else fail(n);
  }
  if (stack.length !== 1 || section !== undefined) throw new Error("the project ends inside a dictionary, list or section");
  const objects = root["objects"];
  if (!isDict(objects)) throw new Error("the project has no objects");
  for (const [id, o] of Object.entries(objects)) {
    if (!ID.test(id) || !isDict(o) || o["isa"] !== sectionOf.get(id)) throw new Error(`the object ${id} is not in its own section`);
  }
  return root;
}

/** Every object of the project by id, each a dictionary with a string isa. */
export function projectObjects(pbxproj: string): [string, Dict][] {
  return Object.entries(readPbxproj(pbxproj)["objects"] as Dict) as [string, Dict][];
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

/** The names of every setting a configuration sets. */
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

/** Every script phase as "shellPath|script", the script as written between its quotes. */
export const shellScripts = (pbxproj: string): string[] =>
  projectObjects(pbxproj)
    .filter(([, o]) => o["isa"] === "PBXShellScriptBuildPhase")
    .map(([, o]) => `${str(o, "shellPath")}|${str(o, "shellScript")}`);
