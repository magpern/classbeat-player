// What the no-real-host guard looks for in source text (ADR 0013 section 2). Pure over strings, so
// the guard test can also run it on text that breaks it.
import { isAllowedOrigin } from "../../src/core/mix/source-setting.ts";

/** The `host` entries of scripts/provider-guard.txt. */
export function guardedHosts(listText: string): string[] {
  return listText.split(/\r?\n/).flatMap((l) => {
    const m = /^host\s+(\S+)\s*$/.exec(l.trim());
    return m ? [m[1]!.toLowerCase()] : [];
  });
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lines naming a guarded host or one of its subdomains. */
export function namedHosts(text: string, hosts: readonly string[]): string[] {
  return hosts.filter((h) => new RegExp(`(^|[^A-Za-z0-9.-])([A-Za-z0-9-]+\\.)*${esc(h)}([^A-Za-z0-9-]|$)`, "i").test(text));
}

/** String values assigned to a mix source origin that are not empty, localhost or 127.0.0.1. */
export function badOrigins(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:mixSourceOrigin|MIX_SOURCE_ORIGIN|mix_source_origin)\s*[:=]\s*(["'`])([^"'`]*)\1/g)) {
    if (!isAllowedOrigin(m[2]!)) out.push(m[2]!);
  }
  return out;
}

/** Any http(s) URL literal whose host is not loopback (for files that belong to the mix source). */
export function foreignUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/gi)) {
    const host = m[1]!.toLowerCase();
    if (host !== "localhost" && !/^127(\.\d+){3}$/.test(host)) out.push(m[0]);
  }
  return out;
}
