// The mix source setting (ADR 0013 section 2): the origin of the real source, empty by default,
// which means off. Pure. Only an empty value or a loopback origin is accepted anywhere in this
// repository; a real origin is a later issue's setting, https only, and the owner's (plan decision 11).
import { UnavailableMixSource } from "./unavailable-source.ts";
import type { MixSource } from "./source.ts";

export interface MixSourceSetting {
  readonly mixSourceOrigin: string;
}

/** Off: no source is set. */
export const DEFAULT_MIX_SOURCE_SETTING: MixSourceSetting = { mixSourceOrigin: "" };

export const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/** The host of an origin, or null when the text is not an http(s) origin. */
export function originHost(origin: string): string | null {
  const m = /^https?:\/\/([^/?#:@\s]+)(?::\d{1,5})?\/?$/i.exec(origin);
  return m ? m[1]!.toLowerCase() : null;
}

/** Empty (off), or an origin whose host is `localhost` or `127.0.0.1`. */
export function isAllowedOrigin(origin: string): boolean {
  if (origin === "") return true;
  const host = originHost(origin);
  return host !== null && LOOPBACK_HOSTS.includes(host);
}

/**
 * The source for a setting. No real client exists yet (ADR 0013 section 7, issue 7), so every
 * setting, an empty one or not, gets the unavailable source: the player behaves as it always has.
 */
export function chooseMixSource(setting: MixSourceSetting = DEFAULT_MIX_SOURCE_SETTING): MixSource {
  void setting; // read when the real client exists (issue 7)
  return new UnavailableMixSource();
}
