// A fake MixSource for tests, the screenshot harness and the developer build (ADR 0013 section 2):
// it serves bytes a test hands it from memory, scripts every refusal, a wrong length, a changed
// file and a stalled read, and records what it was asked. It opens no file, socket or name lookup.
import type { CredentialField, DescribeResult, MixCredentials, MixDescription, MixSource, ReadResult, SignInRefusal, SignInResult } from "../../src/core/mix/source.ts";

export const FAKE_TOKEN = "fake-token-1";

export class FakeMixSource implements MixSource {
  readonly kind = "available" as const;
  readonly calls: string[] = [];
  /** Set to make `signIn` refuse. */
  refuseSignIn: SignInRefusal | null = null;
  /** Set to make `describe` and `read` refuse with an invalid token. */
  tokenInvalid = false;
  /** What `describe` states; `byteLength` defaults to the served bytes' length. */
  mayPlay = true;
  statedByteLength: number | null = null;
  statedDurationMs = 1000;
  version: string | undefined = "v1";
  sha256: string | undefined = undefined;
  /** When set, a read throws (a dropped connection) after yielding this many bytes. */
  failAfterBytes: number | null = null;
  /** Chunks `read` yields before it stalls (never ends) when `stallAfterChunks` is set. */
  stallAfterChunks: number | null = null;
  chunkSize = 4;

  bytes: Uint8Array;
  private readonly fields: readonly CredentialField[];

  constructor(
    bytes: Uint8Array,
    fields: readonly CredentialField[] = [
      { name: "username", secret: false },
      { name: "password", secret: true },
    ],
  ) {
    this.bytes = bytes;
    this.fields = fields;
  }

  credentialFields(): readonly CredentialField[] {
    return this.fields;
  }
  async signIn(credentials: MixCredentials): Promise<SignInResult> {
    this.calls.push(`signIn ${Object.keys(credentials).sort().join(",")}`); // field names only, never a value
    if (this.refuseSignIn !== null) return { ok: false, refusal: this.refuseSignIn };
    return { ok: true, token: FAKE_TOKEN };
  }
  async signOut(): Promise<void> {
    this.calls.push("signOut");
  }
  async describe(token: string, mixId: string): Promise<DescribeResult> {
    this.calls.push(`describe ${mixId}`);
    if (this.tokenInvalid || token !== FAKE_TOKEN) return { ok: false, refusal: "token_invalid" };
    const mix: MixDescription = {
      byteLength: this.statedByteLength ?? this.bytes.length,
      durationMs: this.statedDurationMs,
      ...(this.version === undefined ? {} : { version: this.version }),
      ...(this.sha256 === undefined ? {} : { sha256: this.sha256 }),
      mayPlay: this.mayPlay,
    };
    return { ok: true, mix };
  }
  async read(token: string, mixId: string, fromByte: number): Promise<ReadResult> {
    this.calls.push(`read ${mixId} ${fromByte}`);
    if (this.tokenInvalid || token !== FAKE_TOKEN) return { ok: false, refusal: "token_invalid" };
    const { bytes, chunkSize, stallAfterChunks, failAfterBytes } = this;
    async function* stream(): AsyncGenerator<Uint8Array> {
      let sent = 0;
      let given = 0;
      for (let at = fromByte; at < bytes.length; at += chunkSize) {
        if (stallAfterChunks !== null && sent >= stallAfterChunks) await new Promise<never>(() => {});
        let piece = bytes.slice(at, Math.min(bytes.length, at + chunkSize));
        if (failAfterBytes !== null && given + piece.length > failAfterBytes) piece = piece.slice(0, failAfterBytes - given);
        if (piece.length > 0) yield piece;
        given += piece.length;
        if (failAfterBytes !== null && given >= failAfterBytes) throw new Error("connection dropped");
        sent++;
      }
    }
    return { ok: true, bytes: stream() };
  }
}
