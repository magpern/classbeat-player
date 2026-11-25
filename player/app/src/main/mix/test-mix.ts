// A mix source for the end-to-end tests only (ADR 0013 section 5): with the development-only
// `--test-fake-mix` switch, in an unpackaged build, the shell gets a source that serves a
// generated tone from memory, slowly, and a vault in memory that already holds a token. Nothing
// here reaches the network or the keychain, and a packaged build never honours the switch.
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { MixSource } from "../../core/mix/source.ts";
import type { MixVault } from "./vault.ts";

export const TEST_MIX_SWITCH = "test-fake-mix";

/** Electron's `app`, as far as the switch needs it. */
export interface TestMixApp {
  readonly isPackaged: boolean;
  readonly commandLine: { hasSwitch(name: string): boolean };
}

/** The switch counts only in an unpackaged build: a packaged one never reads it. */
export const testMixOn = (a: TestMixApp): boolean => !a.isPackaged && a.commandLine.hasSwitch(TEST_MIX_SWITCH);
/** The account the test source plays for: fixed, 64 hex digits. */
export const TEST_ACCOUNT = "a".repeat(64);
const TOKEN = "test-token";
/**
 * The mix is as long as the end-to-end tests' class says (`length_ms` of
 * schema/class-format/v1/examples/valid/class-swedebeat-mix-no-offset-exact-fit.json): the shell
 * checks the length the room decodes against it and does not use a mix 1 s or more off.
 */
export const TEST_MIX_MS = 2_700_000;
/** 8-bit mono at 4 kHz: 45 minutes in about 10.8 MB (Chromium decodes from 3 kHz up). */
const RATE = 4000;
/** The source hands out this much at a time, with a pause between, so the download takes seconds. */
const PIECE = 256 * 1024;
const PAUSE_MS = 300;

/** A mono 8-bit WAV: a quiet 440 Hz tone. */
export function toneWav(ms = TEST_MIX_MS, rate = RATE): Uint8Array {
  const samples = Math.round((ms / 1000) * rate);
  const b = Buffer.alloc(44 + samples);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + samples, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(samples, 40);
  // Unsigned 8-bit samples centre on 128.
  for (let i = 0; i < samples; i++) b[44 + i] = 128 + Math.round(8 * Math.sin((2 * Math.PI * 440 * i) / rate));
  return new Uint8Array(b);
}

export function testMixSource(wav: Uint8Array = toneWav(), pauseMs = PAUSE_MS): MixSource {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  return {
    kind: "available",
    credentialFields: () => [],
    signIn: () => Promise.resolve({ ok: false, refusal: "unavailable" }),
    signOut: () => Promise.resolve(),
    describe: (token) => Promise.resolve(token === TOKEN ? { ok: true, mix: { byteLength: wav.length, durationMs: TEST_MIX_MS, mayPlay: true } } : { ok: false, refusal: "token_invalid" }),
    read(token, _mixId, fromByte) {
      if (token !== TOKEN) return Promise.resolve({ ok: false, refusal: "token_invalid" });
      async function* pieces(): AsyncIterable<Uint8Array> {
        for (let at = fromByte; at < wav.length; at += PIECE) {
          await wait(pauseMs);
          yield wav.subarray(at, Math.min(at + PIECE, wav.length));
        }
      }
      return Promise.resolve({ ok: true, bytes: pieces() });
    },
  };
}

/** A vault in memory, with the test account's token already in it. The mix folder is on disk, under `dir`. */
export function testMixVault(dir: string): MixVault {
  const tokens = new Map<string, string>([[TEST_ACCOUNT, TOKEN]]);
  const keys = new Map<string, Buffer>();
  const ending = new Set<string>();
  return {
    available: () => true,
    loadToken: (a) => (ending.has(a) ? null : (tokens.get(a) ?? null)),
    saveToken: (a, t) => void tokens.set(a, t),
    clearToken: (a) => void tokens.delete(a),
    hasKey: (a) => keys.has(a),
    loadKey: (a) => keys.get(a) ?? null,
    createKey(a) {
      const k = keys.get(a) ?? randomBytes(32);
      keys.set(a, k);
      return k;
    },
    clearKey: (a) => void keys.delete(a),
    removeFolder: (a) => rmSync(join(dir, "mixes", a), { recursive: true, force: true }),
    markEnding: (a) => void ending.add(a),
    isEnding: (a) => ending.has(a),
    clearEnding: (a) => void ending.delete(a),
    accounts: () => [...new Set([...tokens.keys(), ...keys.keys(), ...ending])],
  };
}
