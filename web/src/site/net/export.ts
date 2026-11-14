// The account's export (docs/design/site.md, "Your data"; ADR 0002, section 10): `POST
// account/export` answers with the file itself. On success the browser is handed the file to
// save and the page keeps nothing of it: no storage, no address, no log, and the one link to it
// is revoked a moment after the click. Any other answer is read as the site's other answers are.
// A file that arrives after the person left the page or signed out is dropped, not saved.
import type { Answer } from "../core/answer.ts";
import { EXPORT_FILE } from "../core/data-model.ts";
import { answerOfResponse, send } from "./api.ts";

/** How long the link to the file lives after the click: long enough for the browser to start reading it. */
export const REVOKE_AFTER_MS = 10_000;

/**
 * "saved": the browser was handed the file; "dropped": the page was left meanwhile, nothing was
 * saved; otherwise what the answer means. `current` says whether this page is still the one shown.
 */
export async function exportAccount(current: () => boolean): Promise<"saved" | "dropped" | Answer> {
  const res = await send("POST", "account/export");
  if (res === null) return { kind: "offline" };
  if (!current()) return "dropped";
  if (res.type === "opaqueredirect" || res.status < 200 || res.status > 299) return answerOfResponse(res);
  let file: Blob;
  try {
    file = await res.blob();
  } catch {
    // The answer stopped on the way: nothing to save.
    return { kind: "offline" };
  }
  if (!current()) return "dropped";
  try {
    saveFile(file, EXPORT_FILE);
  } catch {
    // The browser refused the file: the export did not happen, and the page says so.
    return { kind: "server" };
  }
  return "saved";
}

/**
 * Hands `file` to the browser's own download as `name`. The link is never put in the document,
 * so the site's link handling never sees it, and it is revoked shortly after the click (revoking at once can cancel the download in some browsers).
 */
export function saveFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
