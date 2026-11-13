// Whether a page's JavaScript heap still holds a string: a garbage collection, then a heap
// snapshot over the DevTools protocol, searched for the string in every string it records
// (sliced and joined strings included). Used to prove a secret is dropped, not only unseen.
import type { Page } from "playwright-core";

export async function heapHolds(page: Page, needle: string): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  const chunks: string[] = [];
  cdp.on("HeapProfiler.addHeapSnapshotChunk", (e) => chunks.push(e.chunk));
  try {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    await cdp.detach();
  }
  const snapshot = JSON.parse(chunks.join("")) as { strings: string[] };
  return snapshot.strings.some((s) => s.includes(needle));
}
