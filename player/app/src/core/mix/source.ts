// The one interface through which the player reaches a music provider's mix (ADR 0013 section 2).
// Types only, no I/O. The audio bytes go from the provider straight to the device: nothing here
// lets a server of ours carry them (plan section 3, rule 3). A mix is named by the provider's own
// opaque id from `music.swedebeat_mix.id`; the types give no Spotify id (ADR 0013 section 6).
// The token is opaque, stays in the main process, and is never shown to a renderer.

/** What the user typed, by field name. Handed to `signIn` once and dropped (ADR 0013 section 1). */
export type MixCredentials = Readonly<Record<string, string>>;

/** One field the source's sign-in asks for. */
export interface CredentialField {
  readonly name: string;
  readonly secret: boolean;
}

export type SignInRefusal = "bad_credentials" | "unavailable" | "rate_limited";
export type SignInResult = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly refusal: SignInRefusal };

/** What the source states about a mix. `sha256` and `version` are optional; without both a download never resumes. */
export interface MixDescription {
  readonly byteLength: number;
  /** The mix's length in ms as the source states it; the decoded length is checked against the class (ADR 0013 section 3). */
  readonly durationMs: number;
  readonly sha256?: string;
  readonly version?: string;
  /** Whether this account may play the mix. */
  readonly mayPlay: boolean;
}

/** `token_invalid`: the source says the token is no longer valid (ADR 0013 section 1: only the token is deleted). */
export type MixRefusal = "unavailable" | "token_invalid" | "not_found";
export type DescribeResult = { readonly ok: true; readonly mix: MixDescription } | { readonly ok: false; readonly refusal: MixRefusal };
export type ReadResult = { readonly ok: true; readonly bytes: AsyncIterable<Uint8Array> } | { readonly ok: false; readonly refusal: MixRefusal };

export interface MixSource {
  /** `unavailable` is the shipped default: the mode policy treats it as "Swedebeat playback is off". */
  readonly kind: "unavailable" | "available";
  /** The fields the sign-in asks for; empty when the source has no sign-in on the device. */
  credentialFields(): readonly CredentialField[];
  signIn(credentials: MixCredentials): Promise<SignInResult>;
  /** Best effort; the local deletion happens whatever it answers. */
  signOut(token: string): Promise<void>;
  describe(token: string, mixId: string): Promise<DescribeResult>;
  /** A byte stream from `fromByte` to the end. */
  read(token: string, mixId: string, fromByte: number): Promise<ReadResult>;
}
