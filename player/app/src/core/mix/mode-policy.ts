// Which clock drives a class: the mix's audio position or the manual clock (ADR 0013 section 4;
// the reasons are docs/design/swedebeat.md "Fall-back reasons"). Pure: no I/O, no clock, no
// provider. A Swedebeat class never uses the Spotify music link and a Spotify or soundless class
// never uses mix playback (rule 3); a reason never names a code, a host, a path or the token.

/** The class's `music.source`, as far as this policy cares. */
export type ClassMusicSource = "spotify" | "swedebeat" | "none";

/**
 * What the cache and the source say about the class's mix right now.
 * `ready`: complete and checked. `streaming`: partly cached, and every chunk the sound needs is there.
 * `downloading`: a chunk the sound needs is missing and 10 s passed, or the sound would catch up.
 * `not_checked`: a chunk or the length failed its check, or the source would not describe it.
 * `not_allowed`: the source says this account may not play it.
 */
export type MixReadiness = "ready" | "streaming" | "downloading" | "not_checked" | "not_allowed";

/** `disabled` is the design spec's `off`; the name avoids the removal-name guard (shell-guard-static). */
export type FallbackReason = "disabled" | "not_connected" | "downloading" | "not_checked" | "no_keychain" | "not_allowed";

/** The plain words of each reason: one fixed list, no full stop (docs/design/swedebeat.md). */
export const REASON_WORDS: Readonly<Record<FallbackReason, string>> = {
  disabled: "Swedebeat playback is off",
  not_connected: "Swedebeat is not connected",
  downloading: "The mix is still downloading",
  not_checked: "The mix could not be checked",
  no_keychain: "Swedebeat cannot be connected here",
  not_allowed: "This account cannot play this mix",
};

/** The shorter forms the room shows for 30 s when a class falls back; only these two can happen mid-class. */
export const SHORT_REASON_WORDS: Readonly<Partial<Record<FallbackReason, string>>> = {
  downloading: "Mix still downloading",
  not_checked: "Mix not checked",
};

export interface ModeInput {
  readonly musicSource: ClassMusicSource;
  /** `music.swedebeat_mix` is present on the class. */
  readonly hasMix: boolean;
  /** The configured source is not `UnavailableMixSource`. */
  readonly sourceAvailable: boolean;
  /** `keychainUsable`: a token can be kept on this computer. */
  readonly keychainUsable: boolean;
  /** The account holds a Swedebeat token. */
  readonly hasToken: boolean;
  readonly readiness: MixReadiness;
}

/**
 * `mix`: play the mix; class time = audio position - `offset_ms`.
 * `manual`: the manual clock, with the reason to show, or null when no mix is involved at all
 * (the class is not a mix class, so there is nothing to explain).
 */
export type ModeResult = { readonly mode: "mix" } | { readonly mode: "manual"; readonly reason: FallbackReason | null };

export function modePolicy(i: ModeInput): ModeResult {
  // Only a Swedebeat class that names a mix can use one; anything else is today's behaviour.
  if (i.musicSource !== "swedebeat" || !i.hasMix) return { mode: "manual", reason: null };
  if (!i.sourceAvailable) return { mode: "manual", reason: "disabled" };
  if (!i.keychainUsable) return { mode: "manual", reason: "no_keychain" };
  if (!i.hasToken) return { mode: "manual", reason: "not_connected" };
  switch (i.readiness) {
    case "ready":
    case "streaming":
      return { mode: "mix" };
    case "downloading":
    case "not_checked":
    case "not_allowed":
      return { mode: "manual", reason: i.readiness };
  }
}

/** The words to show for a result, or null when there is no reason. */
export function reasonWords(r: ModeResult): string | null {
  return r.mode === "manual" && r.reason !== null ? REASON_WORDS[r.reason] : null;
}
