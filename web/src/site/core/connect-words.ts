// The words of Connect an app (docs/design/site.md, "Account"). Pure: no I/O. The app's name is
// the backend's answer to the check, never the page's address.
import { accountPlateWords } from "./account-model.ts";
import type { Words } from "./account-model.ts";
import { LINK_MAX } from "./links-model.ts";
import type { LinkPlate } from "./source-link-model.ts";

export const CONNECT_WORDS = {
  title: "Connect an app",
  checking: "Checking the app that sent you here",
  ask: (name: string): string => `Connect ${name}?`,
  asks: (name: string): string => `${name} asks to send classes to your account.`,
  able: "It will be able to",
  nothingElse: "It will not see your other classes, your devices or your account.",
  connect: (name: string): string => `Connect ${name}`,
  cancel: "Cancel",
  connecting: (name: string): string => `Connecting ${name}`,
  done: "Connected",
  connected: (name: string): string => `${name} is connected`,
  goingBack: (name: string): string => `We emailed you to say so. Taking you back to ${name}…`,
  back: (name: string): string => `Back to ${name}`,
  linkedApps: "Linked apps",
  tryAgain: "Try again",
} as const;

export function linkPlateWords(p: LinkPlate): Words {
  switch (p.kind) {
    case "not-valid":
      return { head: "This link is not valid", detail: "We could not recognise the app that sent you here, so nothing was connected. Go back to it and try again." };
    case "limit":
      return { head: `You have linked ${LINK_MAX} apps already`, detail: "That is the most an account can have. Revoke one you no longer use, then try again." };
    default:
      return accountPlateWords(p);
  }
}
