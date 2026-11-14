// The rider page's address (ADR 0007, section 5; docs/design/rider.md, "Getting in"). Pure: no DOM,
// no I/O. The page at `/j` keeps exactly one thing in its address: the bare join code, `#<join>`,
// so a rider whose token lapsed can join again from the same tab. Anything else goes: a query
// string, and above all a control code (`#<join>.<control>`, the companion page's form), which
// gives control of the class and must never stay in a rider's address or history (rule 14). Only
// the part before the first `.` is read as the join code; everything after it is dropped unread.
// A fragment with no valid join code there is no code at all, and the whole fragment goes.
import { normaliseCode } from "../../companion/core/codes.ts";

/** Longer than any fragment the page is given: such a fragment is not read at all. */
const MAX_FRAGMENT = 40;

export interface RiderAddress {
  /** The join code in its shown form, or null: the rider types it. */
  readonly join: string | null;
  /** What the address must be, as a path with at most `#<join>` after it. */
  readonly target: string;
}

/** The join code a fragment starts with (`#KXPD-RMTB`, `#KXPD-RMTB.<anything>`), or null. */
export function bareJoinCode(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "" || raw.length > MAX_FRAGMENT) return null;
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // A control code (or anything else) after the first `.` is never read, only dropped.
  const first = text.split(".", 1)[0] ?? "";
  return normaliseCode(first);
}

/** The address the page keeps: the path and `#<join>`, or the path alone; never a query string. */
export function riderAddress(pathname: string, hash: string): RiderAddress {
  const join = bareJoinCode(hash);
  return { join, target: join === null ? pathname : `${pathname}#${join}` };
}
