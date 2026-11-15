// The real tokens.css (the screens lane's file, read only) as the accessor `readSceneTokens` takes,
// for the tests and the Node frame-log run. In the browser the page loads the same file and reads
// the computed style.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SceneTokens, StyleSource } from "../src/tokens.ts";
import { readSceneTokens } from "../src/tokens.ts";

export const RENDER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TOKENS_CSS = join(RENDER_DIR, "..", "..", "..", "web", "src", "design", "tokens.css");

export function styleFromCss(css: string): StyleSource {
  const vars = new Map<string, string>();
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  for (const m of (root?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(m[1]!, m[2]!.trim());
  return { getPropertyValue: (name) => vars.get(name) ?? "" };
}

export function tokensFromFile(): SceneTokens {
  return readSceneTokens(styleFromCss(readFileSync(TOKENS_CSS, "utf8")));
}
