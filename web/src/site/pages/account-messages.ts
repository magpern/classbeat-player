// What the account sub-pages show above their content (docs/design/site.md, "Account"): a plate,
// or "Confirm it is you" and its way to classbeat (ADR 0010, section 5). Shared by Sessions,
// Passkeys, Linked apps and Your data.
import { accountPlateWords } from "../core/account-model.ts";
import type { AccountPlate } from "../core/account-model.ts";
import { startReauth } from "../net/classbeat-reauth.ts";
import { uid } from "../ui/dom.ts";
import { button, plate } from "../ui/kit.ts";
import { confirmNodes } from "./confirm.ts";
import type { ConfirmView } from "./confirm.ts";
import type { SignedInEnv } from "./signed-in.ts";

export interface Messages {
  readonly plate: AccountPlate | null;
  readonly confirm: ConfirmView | null;
}

export const NO_MESSAGES: Messages = { plate: null, confirm: null };
export const CONFIRM: Messages = { ...NO_MESSAGES, confirm: { kind: "ask" } };
export const plateOnly = (p: AccountPlate): Messages => (p.kind === "confirm" ? CONFIRM : { ...NO_MESSAGES, plate: p });

export const hasMessage = (m: Messages): boolean => m.plate !== null || m.confirm !== null;

export interface MessageHost {
  readonly env: SignedInEnv;
  /** The messages now shown. */
  readonly get: () => Messages;
  /** Shows these messages and moves focus to them. */
  readonly set: (m: Messages) => void;
}

/** The message nodes. A plate may carry one quiet action ("Try again"). */
export function messageNodes(host: MessageHost, retry?: { readonly text: string; readonly onPress: () => void }): Node[] {
  const m = host.get();
  if (m.confirm) return confirmNodes(m.confirm, { withClassbeat: () => void confirmWithClassbeat(host) });
  if (!m.plate) return [];
  const w = accountPlateWords(m.plate);
  return [plate(w.head, w.detail, retry ? button(retry.text, { quiet: true, onPress: retry.onPress }) : null)];
}

/** "Confirm with classbeat": starts the flow and leaves for classbeat; the change is not made. */
async function confirmWithClassbeat(host: MessageHost): Promise<void> {
  if (host.get().confirm?.kind === "waiting") return;
  host.set({ ...NO_MESSAGES, confirm: { kind: "waiting" } });
  const next = await startReauth();
  if (!host.env.current()) return;
  if (next.kind === "ended") return host.env.sessionEnded();
  if (next.kind === "plate") return host.set({ ...NO_MESSAGES, confirm: { kind: "failed", plate: next.plate } });
  // The plate stays "Opening classbeat…" while the browser leaves.
  location.assign(next.to);
}

/** Gives the plate among `nodes` an id, for a disabled button to point at, and returns it; null when there is none. */
export function idOfPlate(nodes: readonly Node[], stem: string): string | null {
  const found = nodes.find((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains("plate"));
  if (!found) return null;
  found.id = uid(stem);
  return found.id;
}

/** Where focus goes when messages are shown: the plate, else the note, else the page heading. */
export function focusMessage(main: HTMLElement, box: HTMLElement): void {
  (box.querySelector<HTMLElement>(".plate") ?? box.querySelector<HTMLElement>(".note") ?? main.querySelector<HTMLElement>("h1"))?.focus();
}
