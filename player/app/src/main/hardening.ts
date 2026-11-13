// Shell hardening that applies to the whole application: no remote content, no navigation, no new
// windows, no webviews, no permissions. Side effects only; the rules are in web-preferences.ts.
import { app, session } from "electron";
import type { WebContents } from "electron";
import { looseRenderer } from "./loose-renderer.ts";
import type { LiveRenderer } from "./loose-renderer.ts";
import { isAllowedRequest } from "./web-preferences.ts";

// Every renderer, however it was made (a window, a view, window.open), is compared with
// secureWebPreferences as it is created, and again as each navigation starts, loadFile and reload
// included (#154 review, N-3: a session preload registered later applies from the next load); one
// that differs is closed. The spell checker turned on with no load after it is left to the static
// rule (test/unit/shell-guard-check.ts): nothing outside hardening.ts may set it.
// The static check (test/unit/window-prefs-check.ts) is the early warning; this is the guarantee.
// The keys Electron does not report are read another way (loose-renderer.ts); a getter that throws,
// or Electron's `_getPreloadScript` missing after an upgrade, refuses the renderer.
function refuseLoose(contents: WebContents, preloads: readonly string[]): void {
  if (contents.isDestroyed()) return;
  const loose = looseRenderer(contents as unknown as LiveRenderer, () => session.defaultSession, preloads);
  if (loose.length === 0) return;
  console.error(`Refused a renderer that is not hardened (${loose.join(", ")}).`);
  // Closed at once. Inside a window.open that a handler wrongly allowed, this can leave the opener
  // waiting: that fails closed, and guardContents denies every window.open.
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

/** Call once the app is ready, before the first window. `preloads`: the only preload paths a renderer may have. */
export function hardenSession(appDirUrl: string, preloads: readonly string[]): void {
  const ses = session.defaultSession;
  // No dictionaries are downloaded and nothing is checked; every renderer is refused if it is back on.
  ses.setSpellCheckerEnabled(false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, appDirUrl) });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (e) => e.preventDefault());
  app.on("web-contents-created", (_e, contents) => {
    guardContents(contents);
    refuseLoose(contents, preloads);
    contents.on("did-start-navigation", () => refuseLoose(contents, preloads));
  });
}
