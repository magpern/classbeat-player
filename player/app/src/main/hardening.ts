// Shell hardening that applies to the whole application: no remote content, no navigation, no new
// windows, no webviews, no permissions. Side effects only; the rules are in web-preferences.ts.
import { app, session } from "electron";
import type { WebContents } from "electron";
import { isAllowedRequest, looseKeys } from "./web-preferences.ts";

// Every renderer, however it was made (a window, a view, window.open), is compared with
// secureWebPreferences as it is created; one that differs is closed before it loads anything.
// The static check (test/unit/window-prefs-check.ts) is the early warning; this is the guarantee.
function refuseLoose(contents: WebContents): void {
  const reported = (contents as unknown as { getLastWebPreferences(): Record<string, unknown> | null }).getLastWebPreferences();
  const loose = looseKeys(reported, contents.session === session.defaultSession);
  if (loose.length === 0) return;
  console.error(`Refused a renderer that is not hardened (${loose.join(", ")}).`);
  // Closed at once, while it is being created. Inside a window.open that a handler wrongly allowed,
  // this can leave the opener waiting: that fails closed, and guardContents denies every window.open.
  contents.close();
}

function guardContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  // loadFile does not pass through will-navigate, so every navigation the page starts is refused.
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.on("will-frame-navigate", (e) => e.preventDefault());
  contents.on("will-redirect", (e) => e.preventDefault());
  contents.on("will-attach-webview", (e) => e.preventDefault());
}

/** Call before the app is ready. Production always runs sandboxed; only the test switch turns it off. */
export function enableSandboxUnlessTest(): void {
  if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();
}

/** Call once the app is ready, before the first window. */
export function hardenSession(appDirUrl: string): void {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, appDirUrl) });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (e) => e.preventDefault());
  app.on("web-contents-created", (_e, contents) => {
    guardContents(contents);
    refuseLoose(contents);
  });
}
