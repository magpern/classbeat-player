// What the class list page learns about Swedebeat (ADR 0013 section 1, docs/design/swedebeat.md
// "Data"): a state and the names of the fields to show, built field by field. Never a value typed
// in a field, a token, a key, an origin, a path or an account key. Pure.
import type { CredentialField, SignInRefusal } from "./source.ts";

/**
 * `disabled` is the design spec's `off` (the source is `UnavailableMixSource`); the name avoids the
 * removal-name guard (shell-guard-static), as `FallbackReason` does.
 */
export type MixState = "disabled" | "signed_out" | "signing_in" | "signed_in" | "refused";

export interface MixFieldView {
  readonly id: string;
  readonly label: string;
  readonly secret: boolean;
}

export interface MixView {
  readonly state: MixState;
  /** Why the last sign-in was refused; only in `refused`. */
  readonly refusal: SignInRefusal | null;
  /** The token was found invalid and deleted; the mixes are kept (ADR 0013 section 1). */
  readonly needsReconnect: boolean;
  readonly keychainUsable: boolean;
  /** The deletion of sign-out is running: nothing can start. */
  readonly signingOut: boolean;
  /** The fields to type, only while sign-in is offered; never a value. */
  readonly fields: readonly MixFieldView[];
}

/** "username" → "Username": the label is the source's field name, as words. */
export const labelOf = (name: string): string => {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const fieldsView = (fields: readonly CredentialField[]): MixFieldView[] => fields.map((f) => ({ id: f.name, label: labelOf(f.name), secret: f.secret }));

/** The source is off: no field, no key (docs/design/swedebeat.md, "Playback is off"). */
export const MIX_DISABLED: MixView = { state: "disabled", refusal: null, needsReconnect: false, keychainUsable: true, signingOut: false, fields: [] };

/** Whether the page may offer the sign-in form. */
export const mayOfferSignIn = (v: MixView): boolean => (v.state === "signed_out" || v.state === "refused") && v.keychainUsable && !v.signingOut && v.fields.length > 0;
