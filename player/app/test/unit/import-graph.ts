// A small import graph over source text, for the guards that keep two kinds of module apart.
// Type-only imports are erased by the build and carry nothing at run time, so they are not edges.
import { dirname, join, normalize } from "node:path";

export type Files = ReadonlyMap<string, string>;

const FROM = /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** The runtime imports of one file, resolved against `files` (keys are normalised paths). */
export function importsOf(path: string, text: string, files: Files): string[] {
  const out: string[] = [];
  const add = (spec: string): void => {
    if (!spec.startsWith(".")) return;
    const target = normalize(join(dirname(path), spec));
    if (files.has(target)) out.push(target);
  };
  for (const m of text.matchAll(FROM)) if (!m[1]) add(m[2]!);
  for (const m of text.matchAll(DYNAMIC)) add(m[1]!);
  return out;
}

export function graphOf(files: Files): Map<string, string[]> {
  return new Map([...files].map(([p, t]) => [p, importsOf(p, t, files)]));
}

/** Everything `from` reaches, itself included. */
export function closure(graph: ReadonlyMap<string, readonly string[]>, from: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const todo = [...from];
  while (todo.length > 0) {
    const p = todo.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    todo.push(...(graph.get(p) ?? []));
  }
  return seen;
}

/** Each file in `a`'s closure that is in `b`, as "from -> reached". */
export function reaches(graph: ReadonlyMap<string, readonly string[]>, a: (p: string) => boolean, b: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const p of graph.keys()) if (a(p)) for (const q of closure(graph, [p])) if (b(q)) out.push(`${p} -> ${q}`);
  return out;
}
