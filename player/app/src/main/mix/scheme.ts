// The `cbp-mix:` scheme in the main process (ADR 0013 section 5): registered before the app is
// ready with exactly the privileges of core/mix/scheme-policy.ts (never the privilege that bypasses a CSP), and answered
// by main/mix/mix-response.ts. The only file that registers or handles a scheme
// (test/unit/hardening.test.ts). The request filter (hardening.ts) has already cancelled every
// `cbp-mix:` request not from the play's own window by the time the handler runs.
import { protocol, session } from "electron";
import { MIX_SCHEME, MIX_SCHEME_PRIVILEGES } from "../../core/mix/scheme-policy.ts";
import { answerMixRequest } from "./mix-response.ts";
import type { MixResponseDeps } from "./mix-response.ts";

/** Call before the app is ready, once. */
export function registerMixScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MIX_SCHEME, privileges: { ...MIX_SCHEME_PRIVILEGES } }]);
}

/** Call once the app is ready, after `hardenSession`. */
export function handleMixScheme(deps: MixResponseDeps): void {
  session.defaultSession.protocol.handle(MIX_SCHEME, (req) => answerMixRequest(req, deps));
}
