// The "Updated" column of the class list (docs/design/class-list.md): "Today", "Yesterday",
// "9 Nov", and with the year when it is not this year ("14 Dec 2025"), by the device's local
// date. Pure: the clock is an argument, and the month names are a table, not the device's locale.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAY_MS = 86_400_000;

/** The local calendar day as a day number, so that a day's length (a clock change) never matters. */
const dayNumber = (d: Date): number => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);

/**
 * `publishedAt` is an ISO 8601 stamp; `now` is the current time in ms. Null when the time is
 * unknown or is not a time: the screen then shows nothing, never a guess.
 */
export function updatedText(publishedAt: string | null, now: number): string | null {
  if (publishedAt === null) return null;
  const at = new Date(publishedAt);
  const today = new Date(now);
  if (Number.isNaN(at.getTime()) || Number.isNaN(today.getTime())) return null;
  const ago = dayNumber(today) - dayNumber(at);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  const date = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === today.getFullYear() ? date : `${date} ${at.getFullYear()}`;
}
