// Shell hardening that applies to the whole application: no remote content, no navigation, no new
// windows, no webviews, no permissions. Side effects only; the rules are in web-preferences.ts.
import { app, session } from "electron";
import type { WebContents } from "electron";
import { isAllowedRequest } from "./web-preferences.ts";

function guardContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  // loadFile does not pass through will-navigate, so every navigation the page starts is refused.
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.on("will-frame-navigate", (e) => e.preventDefault());
  contents.on("will-redirect", (e) => e.preventDefault());
  contents.on("will-attach-webview", (e) => e.preventDefault());
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
  app.on("web-contents-created", (_e, contents) => guardContents(contents));
}
