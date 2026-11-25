// The download page's rows and sections (docs/design/download.md, "Content"): what a release looks
// like once it is read, and the rows that hold the places while it is read. Plain elements and
// text leaves; the checksum is text, never an image.
import type { Asset, Release } from "../core/download-model.ts";
import { checkLines, checksumGroups, dateWords, SYSTEMS, unsignedHead, UNSIGNED_LINES } from "../core/download-model.ts";
import { el, t, uid } from "../ui/dom.ts";
import "./download.css";

/** The signing label of a row: a hollow square and "Unsigned", or a filled circle and "Signed". Never colour alone. */
const tag = (signed: boolean): HTMLSpanElement => el("span", { class: "tag" }, [el("span", { class: `mark ${signed ? "ok" : "away"}`, "aria-hidden": "true" }), t("small", signed ? "Signed" : "Unsigned", 1)]);

/** Eight groups of eight characters, no whitespace between them: a copy of it is the 64 characters. */
function checksum(sha256: string): HTMLDivElement {
  const sum = el(
    "div",
    { class: "sum" },
    checksumGroups(sha256).map((half) => el("span", { class: "h" }, half.map((g) => el("span", { class: "g" }, [g])))),
  );
  sum.dataset.tier = "minor";
  sum.dataset.minCap = "12";
  sum.dataset.lines = "4";
  return sum;
}

function row(a: Asset): HTMLElement {
  const id = uid("system");
  const go = el("a", { class: "btn primary", "aria-label": `Download for ${a.system}` }, [t("btn", "Download", 2)]);
  go.href = a.url;
  go.rel = "noreferrer";
  return el("section", { class: "dl-row", "aria-labelledby": id }, [
    el("div", { class: "sys" }, [el("h2", { class: "n", id }, [t("h2", a.system, 2)]), tag(a.signed)]),
    el("div", { class: "file" }, [t("small", a.file, 3)]),
    el("div", {}, [el("div", { class: "sumlab" }, [t("label", "SHA-256 checksum", 1)]), checksum(a.sha256)]),
    el("div", { class: "go" }, [go]),
  ]);
}

/** The places of the four systems while the file is read: the names are fixed in the page, so nothing jumps. */
export function waitingRows(): HTMLDivElement {
  return el(
    "div",
    { class: "dl" },
    SYSTEMS.map((name) => {
      const id = uid("system");
      return el("section", { class: "dl-row wait", "aria-labelledby": id, "aria-busy": "true" }, [
        el("div", { class: "sys" }, [el("h2", { class: "n", id }, [t("h2", name, 2)])]),
        el("div", { class: "w" }, [t("body", "Loading", 1)]),
      ]);
    }),
  );
}

/** Part of the page, not an answer to an action, so it has no alert role. */
function unsignedNotice(head: string): HTMLElement {
  const id = uid("unsigned");
  return el("section", { class: "plate unsigned", "aria-labelledby": id }, [
    el("div", { class: "head2" }, [el("span", { class: "mark away", "aria-hidden": "true" }), el("span", { id }, [t("title", head, 3)])]),
    ...UNSIGNED_LINES.map((line) => el("p", { class: "dt" }, [t("body", line)])),
  ]);
}

function checkSection(assets: readonly Asset[]): HTMLElement | null {
  const lines = checkLines(assets);
  if (lines.length === 0) return null;
  const id = uid("check");
  return el("section", { class: "check", "aria-labelledby": id }, [
    el("h2", { id }, [t("h2", "Check a download", 3)]),
    el(
      "dl",
      {},
      lines.flatMap((l) => [el("dt", {}, [t("body", l.family, 1)]), el("dd", {}, [t("body", l.text, 3)])]),
    ),
  ]);
}

/** The version and its date, the release notes link, the notice, the rows and the check lines. */
export function releaseSections(r: Release): HTMLElement[] {
  const num = t("len", `Version ${r.version}`, 1);
  num.className = "num";
  const when = el("span", { class: "when" }, [t("body", `Released ${dateWords(r.date)}`, 2)]);
  const notes = el("a", { class: "a ul notes" }, [t("body", `Release notes for ${r.version}`, 3)]);
  notes.href = r.notes_url;
  notes.rel = "noreferrer";
  const head = unsignedHead(r.assets);
  return [
    el("div", { class: "ver" }, [num, r.prerelease ? preTag() : null, when]),
    notes,
    head === null ? null : unsignedNotice(head),
    el("div", { class: "dl" }, r.assets.map(row)),
    checkSection(r.assets),
  ].filter((x): x is HTMLElement => x !== null);
}

/** "Pre-release", beside the version. A word in a bordered tag; the same tag as the rows' signing label, without a mark. */
function preTag(): HTMLSpanElement {
  return el("span", { class: "tag" }, [t("small", "Pre-release", 1)]);
}
