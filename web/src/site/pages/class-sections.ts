// The three read-only sections of the class details page (docs/design/site.md, "Classes"): Time
// in zone, Songs and Intervals. A zone is an outlined number and a name, never a colour (rule 7,
// check S4). Nothing here edits, reorders or ranks.
import type { Detail } from "../core/class-detail-model.ts";
import { el, t } from "../ui/dom.ts";
import { h2 } from "../ui/kit.ts";

const COLUMNS = ["Start and length", "Zone", "Targets", "Cue"] as const;

function zoneRows(d: Detail): HTMLElement[] {
  if (d.zones.length === 0) return [];
  return [
    h2("Time in zone"),
    ...d.zones.map((z) => el("div", { class: "zrow" }, [el("span", { class: "zn" }, [t("zn", String(z.zone), 1)]), z.name ? t("body", z.name, 2) : el("span"), el("span", { class: "tm" }, [t("len", z.time, 1)])])),
  ];
}

function songRows(d: Detail): HTMLElement[] {
  if (d.songs.length === 0) return [];
  return [
    h2("Songs"),
    ...d.songs.map((s) =>
      el("div", { class: "song" }, [
        el("span", { class: "no" }, [t("small", String(s.no), 1)]),
        el("div", {}, [t("strong", s.title, 3), s.artist ? el("div", {}, [t("small", s.artist, 3)]) : null]),
        el("span", { class: "tm" }, [s.length ? t("len", s.length, 1) : null]),
      ]),
    ),
  ];
}

function intervalRows(d: Detail): HTMLElement[] {
  if (d.intervals.length === 0) return [];
  return [
    h2("Intervals"),
    el("div", { class: "ivh" }, COLUMNS.map((c) => el("span", {}, [t("label", c, 3)]))),
    ...d.intervals.map((iv) =>
      el("div", { class: "iv" }, [
        el("span", { class: "when" }, [t("len", iv.when, 2)]),
        el("span", { class: "zz" }, [t("strong", iv.zone, 2)]),
        iv.targets ? el("span", { class: "dtl" }, [t("small", iv.targets, 2)]) : null,
        iv.cue ? el("span", { class: "cue" }, [t("small", iv.cue, 3)]) : null,
      ]),
    ),
  ];
}

/** Time in zone, Songs and Intervals; a section the class does not have is left out. */
export const sections = (d: Detail): HTMLElement[] => [...zoneRows(d), ...songRows(d), ...intervalRows(d)];
