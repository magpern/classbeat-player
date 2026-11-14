// The account's export (docs/design/site.md, "Your data"; ADR 0002, section 10): `POST
// account/export` answers with the file itself. On success the browser is handed the file to
// save and the page keeps nothing of it: no storage, no address, no log, and the one link to it
// is revoked at once. Any other answer is read as the site's other answers are.
import type { Answer } from "../core/answer.ts";
import { EXPORT_FILE } from "../core/data-model.ts";
import { answerOfResponse, send } from "./api.ts";

/** "saved": the browser was handed the file; otherwise what the answer means. */
export async function exportAccount(): Promise<"saved" | Answer> {
  const res = await send("POST", "account/export");
  if (res === null) return { kind: "offline" };
  if (res.type === "opaqueredirect" || res.status < 200 || res.status > 299) return answerOfResponse(res);
  let file: Blob;
  try {
    file = await res.blob();
  } catch {
    // The answer stopped on the way: nothing to save.
    return { kind: "offline" };
  }
  saveFile(file, EXPORT_FILE);
  return "saved";
}

/**
 * Hands `file` to the browser's own download as `name`. The link is never put in the document,
 * so the site's link handling never sees it, and it is revoked as soon as the download has begun.
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
    URL.revokeObjectURL(url);
  }
}
