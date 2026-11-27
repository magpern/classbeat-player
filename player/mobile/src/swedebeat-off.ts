// The iOS app with Swedebeat off (issue #932; docs/design/swedebeat.md, "The iOS app"). One build
// setting, `swedebeatEnabled`, lives in the iOS project (ios/App/App/Policy/SwedebeatSetting.swift) and is
// off. build-config.mjs reads it from there into this bundle, so native code and the page cannot
// disagree. With it off nothing here reaches Swedebeat: the page shows one fixed dimmed state and a
// class from Swedebeat never opens. Android and the desktop never meet this module's states. Pure.

/** The only wording, verbatim and with no full stop. It gives no reason and no date. */
export const NOT_AVAILABLE = "Not available in this app yet";

/** The line's state words and its key. */
export const SWEDEBEAT_LINE = { state: "Swedebeat", key: "Connect Swedebeat" } as const;

declare const __SWEDEBEAT_ENABLED__: boolean;

/** The build setting as build-config.mjs put it into this bundle. A plain run (a test) reads it as off. */
export const buildSetting = (): boolean => (typeof __SWEDEBEAT_ENABLED__ === "boolean" ? __SWEDEBEAT_ENABLED__ : false);

/** True on the iOS app while the setting is off: the only place the dimmed states are shown. */
export const swedebeatOff = (platform: string, enabled: boolean): boolean => platform === "ios" && !enabled;

/** A class whose songs come from Swedebeat is shown with the message and never starts while Swedebeat is off. */
export const refused = (off: boolean, source: string | undefined): boolean => off && source === "swedebeat";

/** A row's second line: the mix source and song count; the message follows in its own element. */
export function swedebeatFacts(songs: number): string {
  return `Swedebeat, ${songs} ${songs === 1 ? "song" : "songs"}`;
}
