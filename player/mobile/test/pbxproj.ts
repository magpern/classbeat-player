// A reader for the parts of the iOS Xcode project the guards pin (issue #894): the build
// configurations and their settings, the file references, the groups, the object kinds and the
// script phases. It reads the file's text only; anything it cannot read is a finding upstream.

export type BuildConfig = { name: string; base: string | undefined; settings: string };

/** Every XCBuildConfiguration: its name, its base configuration file's id and its settings block. */
export function buildConfigs(pbxproj: string): BuildConfig[] {
  const re =
    /isa = XCBuildConfiguration;\s*(?:baseConfigurationReference = (\w+)[^;\n]*;\s*)?buildSettings = \{([\s\S]*?)\n\t\t\t\};\s*name = ("?)([^";\n]+)\3;/g;
  return [...pbxproj.matchAll(re)].map((m) => ({ name: m[4]!, base: m[1], settings: m[2]! }));
}

/** A setting's value, or undefined when the configuration does not set it. */
export const setting = (c: BuildConfig, key: string): string | undefined =>
  new RegExp(`^\\s*${key} = ("?)([^";\\n]*)\\1;`, "m").exec(c.settings)?.[2];

/**
 * The names of every setting a configuration sets, conditional ones ("KEY[sdk=…]") by their base
 * name. A line at the settings' own depth that is not a setting reads as "?" so it cannot hide one.
 */
export function settingKeys(c: BuildConfig): string[] {
  return c.settings
    .split("\n")
    .filter((l) => /^\t{4}\S/.test(l) && !/^\t{4}\);$/.test(l))
    .map((l) => /^\t{4}("?)([A-Za-z0-9_]+)(?:\[[^\]]*\])?\1 = /.exec(l)?.[2] ?? "?");
}

export type FileRef = { id: string; type: string; sourceTree: string; path: string };

/** Every PBXFileReference, one per line as Xcode writes them. */
export function fileRefs(pbxproj: string): FileRef[] {
  const attr = (body: string, key: string): string => new RegExp(`\\b${key} = ("?)((?:\\\\.|[^";])*)\\1;`).exec(body)?.[2] ?? "";
  return [...pbxproj.matchAll(/^\t\t(\w+) \/\*[^\n]*?\*\/ = \{isa = PBXFileReference;([^\n]*)\};$/gm)].map((m) => ({
    id: m[1]!,
    type: attr(m[2]!, "lastKnownFileType") || attr(m[2]!, "explicitFileType") || "none",
    sourceTree: attr(m[2]!, "sourceTree"),
    path: attr(m[2]!, "path"),
  }));
}

/** Every PBXGroup as "name|path|sourceTree". */
export function groups(pbxproj: string): string[] {
  const attr = (body: string, key: string): string => new RegExp(`^\\t{3}${key} = ("?)([^";\\n]*)\\1;`, "m").exec(body)?.[2] ?? "";
  return [...pbxproj.matchAll(/isa = PBXGroup;([\s\S]*?)\n\t\t\};/g)].map((m) =>
    ["name", "path", "sourceTree"].map((k) => attr(m[1]!, k)).join("|"),
  );
}

/** The kind of every object in the project. */
export const objectKinds = (pbxproj: string): string[] => [...pbxproj.matchAll(/\bisa = (\w+);/g)].map((m) => m[1]!);

/** Every script phase's script, as written in the project (escaped). */
export const shellScripts = (pbxproj: string): string[] => [...pbxproj.matchAll(/\bshellScript = "((?:\\.|[^"\\])*)";/g)].map((m) => m[1]!);
