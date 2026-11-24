// Swedebeat sign-in and sign-out in the main process (ADR 0013 section 1). The credentials arrive
// in one call, are checked against the fields the source declares, handed to its `signIn` once and
// dropped: they are never written, logged, put in a URL or answered back. The token goes only to
// the keychain (main/mix/vault.ts) and never leaves the main process. Ending an account deletes, in
// this order, the cache key, the token and the mix folder; an invalid token deletes the token only.
import { parseCredentials } from "../../core/mix/sign-in-input.ts";
import type { MixSource, SignInRefusal, SignInResult } from "../../core/mix/source.ts";
import { fieldsView, MIX_DISABLED } from "../../core/mix/view.ts";
import type { MixState, MixView } from "../../core/mix/view.ts";
import { MAX_TOKEN_BYTES } from "./vault.ts";
import type { MixVault } from "./vault.ts";

/** The page waits no longer than this for a sign-in; then "Swedebeat could not be reached". */
export const SIGN_IN_WAIT_MS = 30_000;

export interface MixDeps {
  readonly source: MixSource;
  readonly vault: MixVault;
  /** The key of the paired account (sync/link.ts), or null when not paired. */
  readonly account: () => string | null;
  readonly waitMs?: number;
  /** Stops the account's downloads and resolves once none writes any more (main/mix/mix-cache.ts `cancel`). */
  readonly cancelDownloads?: (account: string) => Promise<void>;
}

export interface MixService {
  view(): MixView;
  /** Null when the input or the moment is refused (nothing was sent anywhere). */
  signIn(raw: unknown): Promise<MixView | null>;
  /** Null while a sign-in or sign-out is out. */
  signOut(): Promise<MixView | null>;
  /** The source said the account's token is no longer valid: the token only is deleted. */
  tokenInvalid(account: string): void;
  /** The pairing was deleted (unpaired, or the account deleted): every account here is ended. */
  forgotten(): Promise<void>;
  /** At start: what an ended account left behind (a crash between the steps) is deleted. */
  sweep(): void;
}

type Outcome = SignInResult | { readonly ok: false; readonly refusal: "timeout" };

export function createMixService(d: MixDeps): MixService {
  let busy: "in" | "out" | null = null;
  let refused: { readonly account: string; readonly refusal: SignInRefusal } | null = null;
  const reconnect = new Set<string>();
  // Whether each account holds a token, read from the keychain once; never the token itself.
  const held = new Map<string, boolean>();
  const hasToken = (a: string): boolean => {
    let h = held.get(a);
    if (h === undefined) {
      h = d.vault.available() && d.vault.loadToken(a) !== null;
      held.set(a, h);
    }
    return h;
  };
  // Best effort, after the local deletion or for a token that is not kept: never awaited, never reported.
  const dropRemote = (token: string): void => void Promise.resolve().then(() => d.source.signOut(token)).catch(() => undefined);

  const attempt = (step: () => void): void => {
    try {
      step();
    } catch {
      // nothing is logged: the account key is not for a log either
    }
  };

  // Each step runs even if one before it failed; the next start's sweep retries what is left.
  function forget(a: string): void {
    attempt(() => d.vault.clearKey(a));
    attempt(() => d.vault.clearToken(a));
    held.delete(a);
    reconnect.delete(a);
    if (refused?.account === a) refused = null;
  }

  async function endAccount(a: string): Promise<void> {
    forget(a);
    // The folder goes only once no download of the account writes to it any more.
    await (d.cancelDownloads?.(a) ?? Promise.resolve()).catch(() => undefined);
    attempt(() => d.vault.removeFolder(a));
  }

  function call(credentials: Parameters<MixSource["signIn"]>[0]): Promise<Outcome> {
    const out = Promise.resolve().then(() => d.source.signIn(credentials));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => {
        // A token that arrives after the page was told "could not be reached" is not kept.
        void out.then((r) => (r.ok ? dropRemote(r.token) : undefined), () => undefined);
        resolve({ ok: false, refusal: "timeout" });
      }, d.waitMs ?? SIGN_IN_WAIT_MS);
    });
    return Promise.race([out.catch((): Outcome => ({ ok: false, refusal: "unavailable" })), late]).finally(() => clearTimeout(timer));
  }

  const service: MixService = {
    view() {
      if (d.source.kind === "unavailable") return MIX_DISABLED;
      const keychainUsable = d.vault.available();
      const a = d.account();
      const token = a !== null && keychainUsable && hasToken(a);
      const state: MixState = busy === "in" ? "signing_in" : token ? "signed_in" : a !== null && refused?.account === a ? "refused" : "signed_out";
      const offered = a !== null && keychainUsable && busy === null && (state === "signed_out" || state === "refused");
      return {
        state,
        refusal: state === "refused" ? (refused?.refusal ?? null) : null,
        needsReconnect: a !== null && !token && (reconnect.has(a) || d.vault.hasKey(a)),
        keychainUsable,
        signingOut: busy === "out",
        fields: offered ? fieldsView(d.source.credentialFields()) : [],
      };
    },
    async signIn(raw) {
      if (d.source.kind === "unavailable" || busy !== null) return null;
      const a = d.account();
      if (a === null || !d.vault.available() || hasToken(a)) return null;
      // The one local variable that holds what was typed, for the length of this call.
      let credentials = parseCredentials(raw, d.source.credentialFields());
      if (credentials === null) return null;
      busy = "in";
      refused = null;
      let r: Outcome;
      try {
        r = await call(credentials);
      } finally {
        credentials = null;
        busy = null;
      }
      void credentials;
      if (!r.ok) {
        refused = { account: a, refusal: r.refusal === "timeout" ? "unavailable" : r.refusal };
        return service.view();
      }
      // The pairing changed meanwhile, or the answer is not a token we keep: it is not kept.
      if (d.account() !== a || typeof r.token !== "string" || r.token === "" || Buffer.byteLength(r.token) > MAX_TOKEN_BYTES) {
        dropRemote(String(r.token));
        refused = { account: a, refusal: "unavailable" };
        return service.view();
      }
      try {
        d.vault.saveToken(a, r.token);
        held.set(a, true);
        reconnect.delete(a);
      } catch {
        held.delete(a);
        dropRemote(r.token);
        refused = { account: a, refusal: "unavailable" };
      }
      return service.view();
    },
    async signOut() {
      if (busy !== null) return null;
      const a = d.account();
      if (a === null) return service.view();
      busy = "out";
      try {
        const token = hasToken(a) ? d.vault.loadToken(a) : null;
        await endAccount(a);
        if (token !== null) dropRemote(token);
      } finally {
        busy = null;
      }
      return service.view();
    },
    tokenInvalid(a) {
      try {
        d.vault.clearToken(a);
      } catch {
        // the next view reads the keychain again
      }
      held.delete(a);
      reconnect.add(a);
    },
    async forgotten() {
      const ending = [...new Set([...d.vault.accounts(), ...held.keys()])].map(endAccount);
      refused = null;
      reconnect.clear();
      await Promise.all(ending);
    },
    sweep() {
      // Not when the keychain cannot be read at all: the pairing may still be there.
      if (!d.vault.available()) return;
      const current = d.account();
      // At start no download runs yet, so each account ends at once.
      for (const a of d.vault.accounts()) {
        if (a === current) continue;
        forget(a);
        attempt(() => d.vault.removeFolder(a));
      }
      // Mixes with no key left are files nothing can decrypt.
      if (current !== null && !d.vault.hasKey(current)) {
        try {
          d.vault.removeFolder(current);
        } catch {
          // tried again at the next start
        }
      }
    },
  };
  return service;
}
