// The fixed log lines of the live client (#211, #213, #224 N2): one plain error name and a fixed
// sentence, never an error's text, stack, id or code. Shared by the live service and the room
// remote, so neither imports the other for a line. Pure: no I/O.

/** Only a plain error name, never a message or a stack (#211). */
const errorName = (e: unknown): string => (e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "error");
/** The line for a tracked step that failed. */
export const failedLine = (e: unknown): string => `live session: a step after a backend answer failed (${errorName(e)})`;
/** The line for a change listener that threw. */
export const listenerLine = (e: unknown): string => `live session: a change listener failed (${errorName(e)})`;
