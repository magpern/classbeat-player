// Whether the operating system's secret store can hold the device token (ADR 0002, section 6). Pure.
// Electron's safeStorage encrypts with a key from Keychain (macOS), DPAPI (Windows) or the Secret
// Service or KWallet (Linux). On Linux without one it falls back to "basic_text", a key written in
// Chromium's own source: that is plain text in all but name, so it counts as no keychain at all.

const LINUX_KEYCHAINS = new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]);

export function keychainUsable(platform: string, encryptionAvailable: boolean, linuxBackend: string | null): boolean {
  if (!encryptionAvailable) return false;
  if (platform === "darwin" || platform === "win32") return true;
  return platform === "linux" && linuxBackend !== null && LINUX_KEYCHAINS.has(linuxBackend);
}
