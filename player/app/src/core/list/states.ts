// Which state the class list is in and the words for it (docs/design/class-list.md, "States").
// Pure. The body is chosen in this order: (0) the cache cannot be read, (1) it is being wiped,
// (2) pairing is in progress, (3) not paired, (4) paired. Sentence case, no full stop on a status
// line or a button; the notices from the pairing keep theirs, verbatim.
import { clockText } from "../format.ts";
import { NOTICE_TEXT } from "../pairing/view.ts";
import type { PairingView } from "../pairing/view.ts";
import { SYNC_EVERY_MS } from "../sync/backoff-policy.ts";
import type { ListView } from "./view.ts";

export type Marker = "ok" | "work" | "away";
export type ButtonId = "pair" | "pair-again" | "cancel" | "reopen" | "open-file" | "close";

export interface Button {
  readonly id: ButtonId;
  readonly label: string;
  /** The shortcut shown beside the label ("Esc", "Ctrl+O"), or null. */
  readonly key: string | null;
  readonly primary: boolean;
}
export interface StatusLine {
  readonly marker: Marker;
  readonly text: string;
  readonly detail: string | null;
}
/** A white plate with black text: the states that need the instructor. */
export interface Plate {
  readonly headline: string;
  readonly detail: string | null;
  readonly lines: readonly string[];
  readonly button: Button | null;
}
export interface Step {
  readonly text: string;
  readonly url: string | null;
}
/** A panel that takes the list's place. */
export interface Panel {
  readonly kind: string;
  readonly heading: string;
  readonly text: string | null;
  readonly label: string | null;
  readonly code: string | null;
  readonly steps: readonly Step[];
  readonly note: string | null;
  readonly buttons: readonly Button[];
}
/** What the state decides: the status line or plate, and a panel when the state takes the whole body. */
export interface Head {
  readonly status: StatusLine | null;
  readonly plate: Plate | null;
  readonly panel: Panel | null;
  /** The header's count is shown. */
  readonly counted: boolean;
}

export const LASTING_HEADLINE = "The saved classes cannot be reached";
export const LASTING_TEXT = "They are still on this computer, but the player cannot reach them. Restart the app; if it keeps happening, reinstall it.";
const PASSING_TEXT = "They are still on this computer. Trying again soon. You can still open a class file.";
const MINUTES = SYNC_EVERY_MS / 60_000;

export const OPEN_FILE: Button = { id: "open-file", label: "Open a class file…", key: "Ctrl+O", primary: false };
const PAIR: Button = { id: "pair", label: "Pair this computer", key: null, primary: true };
const CANCEL: Button = { id: "cancel", label: "Cancel", key: "Esc", primary: false };

const panel = (kind: string, heading: string, p: Partial<Omit<Panel, "kind" | "heading">> = {}): Panel => ({ kind, heading, text: null, label: null, code: null, steps: [], note: null, buttons: [], ...p });
const line = (marker: StatusLine["marker"], text: string, detail: string | null = null): StatusLine => ({ marker, text, detail });
const plate = (headline: string, detail: string | null, button: Button | null = null): Plate => ({ headline, detail, lines: [], button });
const paired = (p: Extract<PairingView, { state: "paired" }>): string => `Paired as ${p.email}${p.deviceName === null ? "" : `, “${p.deviceName}”`}`;

function whilePairing(p: Extract<PairingView, { state: "starting" | "waiting" }>): Head {
  if (p.state === "starting") {
    return { status: line("work", "Asking the server for a code…", "This takes a few seconds"), plate: null, counted: false, panel: panel("pairing-start", "Pairing this computer", { buttons: [CANCEL] }) };
  }
  const steps: Step[] = [{ text: "Open", url: p.page }, { text: "Sign in and type the code", url: null }, { text: "Confirm only if this computer shows the same code", url: null }];
  const buttons: Button[] = [{ id: "reopen", label: "Open the page again", key: null, primary: false }, CANCEL];
  return {
    status: line("work", "Waiting for the code to be confirmed on the website", "The pairing page was opened in your browser"),
    plate: null,
    counted: false,
    panel: panel("pairing", "", { label: "Your code", code: p.userCode, steps, note: `The code runs out in ${clockText(p.secondsLeft * 1000)}`, buttons }),
  };
}

function notPaired(message: string | null): Head {
  if (message === null) {
    return { status: line("away", "Not paired", "Your classes are on the player website. Pair this computer to bring them here."), plate: null, counted: false, panel: panel("not-paired", "No classes on this computer", { text: "Pair this computer with your account, or open a class file from disk.", buttons: [PAIR] }) };
  }
  const removed = message === NOTICE_TEXT.revoked_on_site || message === NOTICE_TEXT.unpaired;
  return { status: null, plate: plate(message, removed ? "The classes saved here were removed." : null), counted: false, panel: panel("revoked", "Pair this computer to get your classes", { text: "You can still open a class file from disk.", buttons: [PAIR] }) };
}

/** The status of a paired computer; `held`: classes are cached, so a list can be shown. */
function whilePaired(p: Extract<PairingView, { state: "paired" }>, v: ListView): Head {
  const body = (status: StatusLine | null, pl: Plate | null = null): Head => ({ status, plate: pl, panel: null, counted: true });
  if (p.pairAgain || v.sync.status === "expired") {
    return body(null, plate(`The pairing with ${p.email} has run out`, "Pair again to get new and changed classes. Saved classes still play.", { id: "pair-again", label: "Pair again", key: null, primary: false }));
  }
  switch (v.sync.status) {
    case "synced":
      return body(line("ok", "Up to date", paired(p)));
    case "offline":
      return body(line("away", "Offline", "Showing the classes saved on this computer. Trying again later."));
    case "waiting":
      return body(line("away", "Sync is waiting", "The server is busy or not answering well. Trying again later. Saved classes still play."));
    default: {
      // Syncing; also the moment between the pairing and sync's first run.
      const first = v.rows.length === 0;
      return { ...body(line("work", "Syncing", first ? paired(p) : "Checking for new and changed classes")), counted: !first };
    }
  }
}

export const NO_CLASSES = panel("empty", "No classes yet", { text: `Classes you send to the player appear here. The list checks again every ${MINUTES} minutes.`, buttons: [OPEN_FILE] });
export const FIRST_SYNC = panel("first-sync", "Getting your classes", { text: "They will appear here as they arrive." });
export const NO_MATCH = (text: string): Panel => panel("no-match", `No class matches “${text}”`, { text: "Check the spelling, or press Esc to clear the filter." });

export function headOf(v: ListView): Head {
  const { sync, pairing } = v;
  if (sync.status === "unavailable") {
    const lasting = sync.unavailable === "lasting";
    return {
      status: null,
      plate: lasting ? plate(LASTING_HEADLINE, LASTING_TEXT) : plate("The saved classes could not be read", PASSING_TEXT),
      counted: false,
      panel: panel("unavailable", "Classes not available", { text: "Nothing was deleted. If this stays, restart the player or check the computer’s disk." }),
    };
  }
  if (sync.wiping) {
    return { status: line("work", "Clearing the saved classes", "This computer was unpaired. The classes saved here are being removed."), plate: null, counted: false, panel: panel("wiping", "One moment", { text: "Nothing can start until this is done. You can still open a class file." }) };
  }
  if (pairing.state === "starting" || pairing.state === "waiting") return whilePairing(pairing);
  if (pairing.state === "unpaired") return notPaired(pairing.message);
  return whilePaired(pairing, v);
}
