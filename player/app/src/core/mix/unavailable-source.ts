// The mix source of every shipped build (ADR 0013 section 2): no sign-in fields, every call
// answers `unavailable`, and it touches nothing. With it the Swedebeat mode is the manual clock,
// exactly as before this module existed.
import type { DescribeResult, MixSource, ReadResult, SignInResult } from "./source.ts";

export class UnavailableMixSource implements MixSource {
  readonly kind = "unavailable" as const;
  credentialFields(): readonly [] {
    return [];
  }
  async signIn(): Promise<SignInResult> {
    return { ok: false, refusal: "unavailable" };
  }
  async signOut(): Promise<void> {}
  async describe(): Promise<DescribeResult> {
    return { ok: false, refusal: "unavailable" };
  }
  async read(): Promise<ReadResult> {
    return { ok: false, refusal: "unavailable" };
  }
}
