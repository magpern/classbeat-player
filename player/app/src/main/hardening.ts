// Shell hardening that applies to the whole application: no remote content, no navigation, no new
// windows, no webviews, no permissions. Side effects only; the rules are in web-preferences.ts.
import { app, protocol, session } from "electron";
import type { WebContents } from "electron";
import { MIX_SCHEME, MIX_SCHEME_PRIVILEGES } from "../core/mix/scheme-policy.ts";
import { LOCAL_SCHEME, LOCAL_SCHEME_PRIVILEGES } from "../core/music-files/local-scheme-policy.ts";
import { answerMixRequest } from "./mix/mix-response.ts";
import type { MixResponseDeps } from "./mix/mix-response.ts";
import { refuse, refuseLoose } from "./refuse-loose.ts";
import type { RefusableRenderer, RefuseDeps } from "./refuse-loose.ts";
import { isAllowedRequest } from "./web-preferences.ts";
import type { LivePlay } from "./web-preferences.ts";

// Every renderer, however it was made (a window, a view, window.open), is compared with
// secureWebPreferences as it is created, and again as each navigation starts, loadFile and reload
// included (#154 review, N-3: a session preload registered later applies from the next load); one
// that differs is closed. The spell checker turned on with no load after it is left to the static
// rule (test/unit/shell-guard-check.ts): nothing outside hardening.ts may set it.
// The static check (test/unit/window-prefs-check.ts) is the early warning; this is the guarantee.
// The keys Electron does not report are read another way (loose-renderer.ts); a getter that throws,
// or Electron's `_getPreloadScript` missing after an upgrade, refuses the renderer. The refusal
// itself (refuse-loose.ts) never throws out of these listeners (#156 review, N-2).
const refuseDeps = (preloads: readonly string[]): RefuseDeps => ({
  defaultSession: () => session.defaultSession,
  preloads,
  report: (message) => console.error(message),
  // A renderer that cannot be closed must not go on loading: the application ends instead.
  fatal: () => app.exit(1),
});

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

/**
 * Call once the app is ready, before the first window. `preloads`: the only preload paths a renderer
 * may have. `livePlay`: whether a `cbp-mix:` play id is live for the requesting renderer;
 * `liveLocal`: the same for a `cbp-local:` play id.
 */
export function hardenSession(appDirUrl: string, preloads: readonly string[], livePlay?: LivePlay, liveLocal?: LivePlay): void {
  const ses = session.defaultSession;
  // No dictionaries are downloaded and nothing is checked; every renderer is refused if it is back on.
  ses.setSpellCheckerEnabled(false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, appDirUrl, details.webContentsId, livePlay, liveLocal) });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (e) => e.preventDefault());
  const deps = refuseDeps(preloads);
  app.on("web-contents-created", (_e, contents) => {
    // getLastWebPreferences and _getPreloadScript are Electron's own, missing from its typings.
    const live = contents as unknown as RefusableRenderer;
    try {
      guardContents(contents);
      contents.on("did-start-navigation", () => refuseLoose(live, deps));
    } catch {
      // A renderer without its navigation guards, or without the re-check on each load, is refused.
      refuse(live, ["guards"], deps);
      return;
    }
    refuseLoose(live, deps);
  });
}

// The `cbp-mix:` scheme (ADR 0013 section 5) and the `cbp-local:` scheme (ADR 0017 section 3):
// registered together before the app is ready with exactly the privileges of
// core/mix/scheme-policy.ts and core/music-files/local-scheme-policy.ts (never the privilege that
// bypasses a CSP), and answered by main/mix/mix-response.ts and main/music-files/local-response.ts
// (injected by main.ts). The only place that registers or handles a scheme
// (test/unit/hardening.test.ts). The request filter above has already cancelled every request of
// either scheme not from the play's own window by the time a handler runs.

/** Call before the app is ready, once: Electron takes one registration of every privileged scheme. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MIX_SCHEME, privileges: { ...MIX_SCHEME_PRIVILEGES } },
    { scheme: LOCAL_SCHEME, privileges: { ...LOCAL_SCHEME_PRIVILEGES } },
  ]);
}

/** Call once the app is ready, after `hardenSession`. */
export function handleMixScheme(deps: MixResponseDeps): void {
  session.defaultSession.protocol.handle(MIX_SCHEME, (req) => answerMixRequest(req, deps));
}

/** Call once the app is ready, after `hardenSession`: `answer` is main/music-files/local-response.ts with its deps. */
export function handleLocalScheme(answer: (req: Request) => Promise<Response>): void {
  session.defaultSession.protocol.handle(LOCAL_SCHEME, (req) => answer(req));
}
