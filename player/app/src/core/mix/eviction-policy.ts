// Which cached mixes an account's cache deletes (ADR 0013 section 3). Pure. A mix no class of the
// account names any more goes; a mix not used for 90 days goes; above the size cap the mixes used
// least recently go first, then the kept ones (of classes that may start within 24 hours), least
// recently used first. A pinned mix (the one playing, the open class's) never goes.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRY_MS = 90 * DAY_MS;
/** The default cap per account: 4 GiB. */
export const DEFAULT_CAP_BYTES = 4 * 1024 ** 3;

export interface CachedMix {
  readonly tag: string;
  /** Bytes on disk, header included. */
  readonly bytes: number;
  readonly usedAt: number;
}

export interface EvictionInput {
  readonly now: number;
  readonly capBytes: number;
  /** Mixes deleted only above the cap, after every other. */
  readonly keep: ReadonlySet<string>;
  /** Mixes never deleted now. */
  readonly pinned?: ReadonlySet<string>;
  /** The mixes some class of the account names; when absent, that rule is not applied. */
  readonly named?: ReadonlySet<string>;
}

const byUse = (a: CachedMix, b: CachedMix): number => a.usedAt - b.usedAt || (a.tag < b.tag ? -1 : 1);

/** The tags to delete, in the order they are chosen. */
export function evictionPlan(mixes: readonly CachedMix[], input: EvictionInput): string[] {
  const pinned = input.pinned ?? new Set<string>();
  const out: string[] = [];
  const left: CachedMix[] = [];
  for (const m of mixes) {
    if (pinned.has(m.tag) || input.keep.has(m.tag)) left.push(m);
    else if (input.named !== undefined && !input.named.has(m.tag)) out.push(m.tag);
    else if (input.now - m.usedAt >= EXPIRY_MS) out.push(m.tag);
    else left.push(m);
  }
  let total = left.reduce((s, m) => s + m.bytes, 0);
  const free = left.filter((m) => !pinned.has(m.tag));
  const order = [...free.filter((m) => !input.keep.has(m.tag)).sort(byUse), ...free.filter((m) => input.keep.has(m.tag)).sort(byUse)];
  for (const m of order) {
    if (total <= input.capBytes) break;
    out.push(m.tag);
    total -= m.bytes;
  }
  return out;
}
