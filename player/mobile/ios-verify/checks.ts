// The checks of the iOS app's Info.plist, build settings and entitlements against the shared
// allowlists (issue #894). Pure: each takes what a reader made of a file (the Linux guards' own
// readers, or Apple's plutil on macOS) and returns what is wrong, one line each.
import { isDeepStrictEqual } from "node:util";
import {
  APP_FONTS, BANNED_KEY, BANNED_PROJECT_WORDS, BUILD_ADDED_KEYS, DEBUG_ATS, DEBUG_ENTITLEMENTS, ENTITLEMENTS, INFO_KEYS, type Json, OBJECT_KINDS, scenes,
  SETTING_KEYS,
} from "./allowlists.ts";

type Dict = { [key: string]: Json };
export const isDict = (v: Json | undefined): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every key in a property list, at any depth, as a path ("a.b[0].c"). */
export function keysAt(v: Json, at = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => keysAt(x, `${at}[${i}].`));
  if (!isDict(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => [`${at}${k}`, ...keysAt(x, `${at}${k}.`)]);
}
const lastKey = (path: string): string => path.replace(/^.*\]?\./, "");

export type PlistKind = { debug: boolean; built: boolean };

/** What is wrong with an Info.plist: a key off the allowlist, a banned key at any depth, another
 * scene manifest, or transport security other than none (release) or the localhost exception (debug). */
export function plistFindings(name: string, plist: Json, { debug, built }: PlistKind): string[] {
  if (!isDict(plist)) return [`${name}: the Info.plist is not a dictionary`];
  const found: string[] = [];
  for (const k of Object.keys(plist)) {
    if (k !== "NSAppTransportSecurity" && !INFO_KEYS.has(k) && !(built && BUILD_ADDED_KEYS.has(k))) found.push(`${name}: ${k} is not on the allowlist`);
  }
  for (const path of keysAt(plist)) if (BANNED_KEY.test(lastKey(path))) found.push(`${name}: ${path} is banned`);
  if (!isDeepStrictEqual(plist["UIApplicationSceneManifest"], scenes(built ? "App" : undefined))) {
    found.push(`${name}: the scene manifest is not the one window scene`);
  }
  if (!isDeepStrictEqual(plist["UIAppFonts"], APP_FONTS)) found.push(`${name}: UIAppFonts is not the three bundled fonts`);
  const ats = plist["NSAppTransportSecurity"];
  if (!debug && ats !== undefined) found.push(`${name}: NSAppTransportSecurity is set (HTTPS only means no exception)`);
  if (debug && !isDeepStrictEqual(ats, DEBUG_ATS)) found.push(`${name}: the transport security is not the localhost exception alone`);
  return found;
}

/** What is wrong with one build configuration's settings: an INFOPLIST_ setting but the file (Xcode
 * would merge INFOPLIST_KEY_* into the shipped plist), a setting off the allowlist, or DEBUG
 * outside the Debug configuration. */
export function settingFindings(name: string, settings: Dict): string[] {
  const found: string[] = [];
  for (const key of Object.keys(settings)) {
    if (/^INFOPLIST_/.test(key) && key !== "INFOPLIST_FILE") found.push(`${name}: sets ${key}`);
    else if (!SETTING_KEYS.has(key)) found.push(`${name}: ${key} is not an allowed setting`);
  }
  const flags = Object.entries(settings).filter(([k]) => !/^(DEBUG_INFORMATION_FORMAT|MTL_ENABLE_DEBUG_INFO)$/.test(k));
  if (name !== "Debug" && /DEBUG/.test(JSON.stringify(flags))) found.push(`${name}: compiles with DEBUG`);
  return found;
}

/** What is wrong with a project as a reader gives it: an object kind off the list, settings on
 * anything but a build configuration, a configuration's settings, an INFOPLIST_ name but the file
 * anywhere, or a banned word. */
export function projectJsonFindings(project: Json): string[] {
  const objects = isDict(project) ? project["objects"] : undefined;
  if (!isDict(objects)) return ["the project has no objects"];
  const found: string[] = [];
  let configs = 0;
  for (const [id, o] of Object.entries(objects)) {
    const kind = isDict(o) ? o["isa"] : undefined;
    if (!isDict(o) || typeof kind !== "string") {
      found.push(`the object ${id} has no kind`);
      continue;
    }
    if (!OBJECT_KINDS.has(kind)) found.push(`the project has a ${kind}`);
    const settings = o["buildSettings"];
    if (kind !== "XCBuildConfiguration") {
      if (settings !== undefined) found.push(`${id} has build settings`);
      continue;
    }
    configs++;
    if (!isDict(settings) || typeof o["name"] !== "string") found.push(`the build configuration ${id} could not be read`);
    else found.push(...settingFindings(o["name"], settings));
  }
  if (configs === 0) found.push("the project has no build configurations");
  const all = JSON.stringify(project);
  for (const m of all.matchAll(/INFOPLIST_(?!FILE\b)\w*/g)) found.push(`the project names ${m[0]}`);
  for (const word of BANNED_PROJECT_WORDS) if (all.includes(word)) found.push(`the project has ${word}`);
  return found;
}

/** What is wrong with a built app's entitlements: anything but Xcode's default identity, a
 * keychain group other than the app's own, or a debugger outside a debug build. */
export function entitlementFindings(name: string, entitlements: Json, debug: boolean): string[] {
  if (!isDict(entitlements)) return [`${name}: the entitlements are not a dictionary`];
  const found: string[] = [];
  const app = entitlements["application-identifier"];
  for (const [k, v] of Object.entries(entitlements)) {
    if (debug && DEBUG_ENTITLEMENTS.has(k) ? v !== true : !ENTITLEMENTS.has(k)) found.push(`${name}: the entitlement ${k} is not allowed`);
  }
  for (const k of ["application-identifier", "com.apple.developer.team-identifier"]) {
    if (k in entitlements && typeof entitlements[k] !== "string") found.push(`${name}: ${k} is not a string`);
  }
  const groups = entitlements["keychain-access-groups"];
  if (groups !== undefined && !isDeepStrictEqual(groups, [app])) found.push(`${name}: a keychain group is not the app's own`);
  return found;
}
