// The format_version gate shared by the Ajv-based checker and the build-time-compiled reader. Pure.
import type { Violation } from "./semantic.ts";

const KNOWN_MAJOR = 1;

export function versionProblem(version: unknown): Violation | null {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)$/.exec(version) : null;
  if (m === null) return ["schema", "/format_version"];
  if (Number(m[1]) !== KNOWN_MAJOR) return ["unsupported_major", "/format_version"];
  return null;
}
