// What the update notice and the Settings page's "Updates" part say (docs/design/updates.md,
// "States", "The switches" and "Wording"). Pure: words and shapes from an UpdateView. No address of
// any kind is ever part of it.
import type { UpdateView } from "./view.ts";

/** The class list's marker shapes, plus the filled square for news (system.md, "Status markers"). */
export type Marker = "ok" | "news" | "work" | "away";

export interface StatusWords {
  readonly marker: Marker;
  readonly words: string;
  readonly detail: string;
}

export interface Fact {
  /** The version as its tag has it, or null for "Not known". */
  readonly version: string | null;
  /** A hyphen part: the "Pre-release" tag goes beside it. */
  readonly pre: boolean;
}

export interface SwitchWords {
  readonly name: string;
  readonly help: string;
  readonly on: boolean;
}

export interface SettingsWords {
  readonly status: StatusWords;
  /** "Open release page" exists only in the newer states (U10). */
  readonly open: boolean;
  /** Check now is dimmed with aria-disabled while a check runs. */
  readonly busy: boolean;
  readonly current: Fact;
  readonly latest: Fact;
  readonly auto: SwitchWords;
  readonly prereleases: SwitchWords;
}

export interface NoticeWords {
  readonly version: string;
  readonly pre: boolean;
  readonly detail: string;
}

export const NOT_KNOWN = "Not known";

/** A version with a hyphen part is a pre-release (ADR 0014 section 1). */
const isPre = (version: string): boolean => /^[^+]*-/.test(version);
const fact = (version: string | null): Fact => ({ version, pre: version !== null && isPre(version) });

export function statusWords(v: UpdateView): StatusWords {
  switch (v.kind) {
    case "up to date":
      return { marker: "ok", words: "Up to date", detail: "You have the newest version." };
    case "newer":
      return { marker: "news", words: "Newer version available", detail: `Version ${v.notice ?? v.latest ?? ""} is on its release page. Nothing is downloaded or installed.` };
    case "checking":
      return { marker: "work", words: "Checking…", detail: "Looking for a newer version." };
    case "could not check":
      return { marker: "away", words: "Could not check", detail: v.checked ? "The list of releases could not be read. Press Check now to try again." : "No check has run yet. Press Check now." };
  }
}

export function settingsWords(v: UpdateView): SettingsWords {
  return {
    status: statusWords(v),
    open: v.kind === "newer" && v.notice !== null,
    busy: v.kind === "checking",
    current: fact(v.current),
    latest: fact(v.latest),
    auto: {
      name: "Check automatically",
      help: v.auto ? "At start and every 6 hours while the player is open." : "Off: the player looks for a newer version only when you press Check now.",
      on: v.auto,
    },
    prereleases: { name: "Pre-releases", help: "Also tell me about test versions, which come before a normal release.", on: v.prereleases },
  };
}

/** The class list's notice, or null: only for a newer version, and kept while a new check runs. */
export function noticeWords(v: UpdateView | null): NoticeWords | null {
  if (v === null || v.notice === null) return null;
  return { version: v.notice, pre: isPre(v.notice), detail: `You have ${v.current}. Nothing is downloaded or installed.` };
}
