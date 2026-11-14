// The two pages of the Devices section (docs/design/site.md, "Devices and pairing"), once their
// first request has been answered: the device list, and pairing a device.
import type { SignedInPage } from "../core/routes.ts";
import { devicesPage } from "./devices.ts";
import { pairPage } from "./pair.ts";
import type { SignedInEnv } from "./signed-in.ts";

/** Shows a page of the Devices section for the body of its first request; false for any other page. */
export function shownByDevicePage(main: HTMLElement, page: SignedInPage, body: unknown, env: SignedInEnv, focus: boolean, reload: () => void): boolean {
  if (page.nav !== "devices") return false;
  if (page.load === "devices") devicesPage(main, body, env, focus, reload);
  // /pair reads `sessions` first only to know the person is signed in; its body is not used.
  else pairPage(main, env, focus);
  return true;
}
