// Turns validator errors into violations: one per pointer, sorted. Pure; no validator import.
import { sortViolations } from "./semantic.ts";
import type { Violation } from "./semantic.ts";

export function violationsFromErrors(errors: readonly { instancePath: string }[], prefix: string): Violation[] {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const e of errors) {
    const pointer = prefix + e.instancePath;
    if (!seen.has(pointer)) {
      seen.add(pointer);
      out.push(["schema", pointer]);
    }
  }
  return sortViolations(out);
}
