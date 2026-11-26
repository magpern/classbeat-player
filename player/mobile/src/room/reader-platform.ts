// Whether this platform has a music reader at all (ADR 0016, section 5). Pure: it takes the
// platform's name (`platformName()` in modes/bridge.ts), so the room knows from the first frame and asks
// native code nothing (the #872 pin: nothing about the music before Follow is pressed). The iOS app
// has no reader; if the owner later clears one (decision 15) this is the one line that changes.
export function hasMusicReader(platform: string): boolean {
  return platform !== "ios";
}
