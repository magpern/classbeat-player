// What the account sub-pages show above their content (docs/design/site.md, "Account"): a plate,
// "Confirm it is you", or the note after signing in again; and the way back from the prompt.
// Shared by Sessions and Passkeys.
import { accountPlateWords } from "../core/account-model.ts";
import type { AccountPlate } from "../core/account-model.ts";
import { button, plate } from "../ui/kit.ts";
import { confirmByPasskey, confirmedNote, confirmNodes } from "./confirm.ts";
import type { ConfirmView } from "./confirm.ts";
import type { SignedInEnv } from "./signed-in.ts";

export interface Messages {
  readonly plate: AccountPlate | null;
  readonly confirm: ConfirmView | null;
  readonly confirmed: boolean;
}

export const NO_MESSAGES: Messages = { plate: null, confirm: null, confirmed: false };
export const CONFIRM: Messages = { ...NO_MESSAGES, confirm: { kind: "ask" } };
export const plateOnly = (p: AccountPlate): Messages => (p.kind === "confirm" ? CONFIRM : { ...NO_MESSAGES, plate: p });

export const hasMessage = (m: Messages): boolean => m.plate !== null || m.confirm !== null || m.confirmed;

export interface MessageHost {
  readonly env: SignedInEnv;
  /** The messages now shown. */
  readonly get: () => Messages;
  /** Shows these messages and moves focus to them. */
  readonly set: (m: Messages) => void;
  /** Reads the page's list again, then shows these messages. */
  readonly readAgain: (m: Messages) => void;
}

/** The message nodes. A plate may carry one quiet action ("Try again"). */
export function messageNodes(host: MessageHost, retry?: { readonly text: string; readonly onPress: () => void }): Node[] {
  const m = host.get();
  if (m.confirm) {
    return confirmNodes(m.confirm, {
      usePasskey: () => void confirmHere(host),
      emailLink: () => host.env.confirmByLink(),
    });
  }
  const out: Node[] = [];
  if (m.plate) {
    const w = accountPlateWords(m.plate);
    out.push(plate(w.head, w.detail, retry ? button(retry.text, { quiet: true, onPress: retry.onPress }) : null));
  }
  if (m.confirmed) out.push(confirmedNote());
  return out;
}

/** "Use a passkey": signs in again here; the list is read again, and the change is not made. */
async function confirmHere(host: MessageHost): Promise<void> {
  if (host.get().confirm?.kind === "waiting") return;
  host.set({ ...NO_MESSAGES, confirm: { kind: "waiting" } });
  const result = await confirmByPasskey();
  if (!host.env.current()) return;
  if (result === "confirmed") return host.readAgain({ ...NO_MESSAGES, confirmed: true });
  host.set({ ...NO_MESSAGES, confirm: { kind: "failed", plate: result } });
}

/** Where focus goes when messages are shown: the plate, else the note, else the page heading. */
export function focusMessage(main: HTMLElement, box: HTMLElement): void {
  (box.querySelector<HTMLElement>(".plate") ?? box.querySelector<HTMLElement>(".note") ?? main.querySelector<HTMLElement>("h1"))?.focus();
}
