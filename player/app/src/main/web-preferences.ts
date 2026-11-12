// The hardening settings of every window, kept free of Electron imports so a unit test can check
// them. The e2e test reads the same values back from the running windows.

/** The presenter page's Content Security Policy; presenter.html carries it as its first meta tag. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export interface SecureWebPreferences {
  readonly preload: string;
  readonly contextIsolation: true;
  readonly sandbox: true;
  readonly nodeIntegration: false;
  readonly nodeIntegrationInWorker: false;
  readonly nodeIntegrationInSubFrames: false;
  readonly webSecurity: true;
  readonly allowRunningInsecureContent: false;
  readonly webviewTag: false;
  readonly experimentalFeatures: false;
  readonly enableBlinkFeatures: "";
  readonly navigateOnDragDrop: false;
  readonly spellcheck: false;
  readonly safeDialogs: true;
}

export function secureWebPreferences(preload: string): SecureWebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    enableBlinkFeatures: "",
    navigateOnDragDrop: false,
    spellcheck: false,
    safeDialogs: true,
  };
}

/** Only the application's own files may load. Everything else (http, https, ws, data, ...) is cancelled. */
export function isAllowedRequest(url: string, appDirUrl: string): boolean {
  return url.startsWith(appDirUrl);
}
