// The words of the two modes' start pages (docs/design/app-modes.md, "Wording") and the checks on
// what native code answers (issue #630). Pure: no DOM, no bridge. The page never chooses a mode; it
// only asks, and reads back one of a few fixed words, anything else being treated as "nothing
// changed".

export const RIDER = {
  tag: "Rider mode",
  title: "Join a class",
  hint: "Type the class code from the room screen.",
  key: "Switch to instructor mode",
  lead: {
    pair: "Teaching? Switch to pair this phone with your account.",
    lock: "Teaching? Your screen lock opens instructor mode.",
  },
  notConfirmed: { head: "Still in rider mode", detail: "Instructor mode opens only after your screen lock." },
} as const;

export const INSTRUCTOR = {
  tag: "Instructor mode",
  title: "Classes",
  status: "Up to date",
  key: "Switch to rider mode",
} as const;

/** How a rider gets into instructor mode on this phone: pairing first, or the screen lock. */
export type Way = keyof typeof RIDER.lead;

/** What native code says after a question it asked ended without a switch. */
export type Answer = "stayed" | "notConfirmed" | "unpaired";

const ANSWERS: readonly Answer[] = ["stayed", "notConfirmed", "unpaired"];

/** The way from instructorWay's answer. Anything unexpected reads as "pair", the way that opens nothing. */
export function parseWay(reply: unknown): Way {
  return only(reply, "way") === "lock" ? "lock" : "pair";
}

/** The answer from askInstructorMode or askRiderMode. Anything unexpected reads as "stayed". */
export function parseAnswer(reply: unknown): Answer {
  const v = only(reply, "result");
  return ANSWERS.find((a) => a === v) ?? "stayed";
}

/** The value of an object's one own key, or undefined when the reply has any other shape. */
function only(reply: unknown, key: string): unknown {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return undefined;
  const keys = Object.keys(reply);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  return (reply as Record<string, unknown>)[key];
}
