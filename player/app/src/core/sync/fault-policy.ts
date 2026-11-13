// Which cache read faults a retry cannot cure. Pure: it looks at an error's `code` and nothing else.

/**
 * A file where the class folder should be (`ENOTDIR`), or a folder where a class file or the
 * cursor file should be (`EISDIR`, as Windows reports it): reading again finds the same thing,
 * until someone removes it. Any other fault (a disk error, no permission, a busy file) may pass.
 */
const LASTING = new Set(["ENOTDIR", "EISDIR"]);

export function lastingFault(e: unknown): boolean {
  const code = e !== null && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" && LASTING.has(code);
}
