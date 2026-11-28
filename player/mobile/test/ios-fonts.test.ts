// The bundled fonts of the native pairing screens (#988, #993): each iOS font copy has its licence beside it, the same file as the
// other copies of these fonts (the app's design folder), and UIAppFonts in both plists names exactly the three font files.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { APP_FONTS } from "../ios-verify/allowlists.ts";
import { IOS } from "./ios-sources.ts";
import { readPlist } from "./plist.ts";

const APP = join(IOS, "App", "App");
const SOURCE = join(IOS, "..", "..", "app", "src", "renderer", "design", "fonts");
const LICENCES = ["OFL-atkinson-hyperlegible.txt", "OFL-big-shoulders-display.txt"];

test("the iOS font copies have their licence files beside them, unchanged", () => {
  for (const licence of LICENCES) assert.deepEqual(readFileSync(join(APP, licence)), readFileSync(join(SOURCE, licence)), licence);
});

test("every font file UIAppFonts names is beside the plists, and each family has its licence", () => {
  for (const plist of ["Info.plist", "Info-Debug.plist"]) {
    const fonts = (readPlist(readFileSync(join(APP, plist), "utf8")) as { [key: string]: unknown })["UIAppFonts"];
    assert.deepEqual(fonts, APP_FONTS, plist);
    for (const f of fonts as string[]) assert.ok(existsSync(join(APP, f)), f);
  }
  for (const licence of LICENCES) assert.ok(existsSync(join(APP, licence)), licence);
});
