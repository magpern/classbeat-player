// The Swedebeat sign-in channels (ADR 0013 section 1). Only the class list page may use them: the
// sender is checked first, before anything is read. A refused message gets null and changes
// nothing. The answer is the ListView, which carries the sign-in state and never a token or a
// value that was typed; nothing here logs. After a sign-in or a sign-out, `changed` lets the
// downloads ahead see the new sign-in state at once (main/mix/prefetch.ts `check`), so a sign-out
// followed by a sign-in with no snapshot between still asks every mix again (#720, N13).
import { CH_MIX_SIGN_IN, CH_MIX_SIGN_OUT } from "../../core/channels.ts";
import { MIX_PAGE } from "../../core/ipc-policy.ts";
import type { Trusted } from "../../core/ipc-policy.ts";
import type { IpcBus } from "../ipc-handlers.ts";
import { pageEvent } from "../ipc-handlers.ts";
import type { ListController } from "../list/list-controller.ts";
import type { MixService } from "./service.ts";

export function registerMixHandlers(bus: IpcBus, trusted: () => Trusted, mix: MixService, list: Pick<ListController, "view">, changed: () => void = () => undefined): void {
  const onList = (e: Parameters<typeof pageEvent>[0]): boolean => pageEvent(e, trusted) === MIX_PAGE;
  bus.handle(CH_MIX_SIGN_IN, async (e, raw) => {
    if (!onList(e)) return null;
    // The service parses and refuses; `raw` is not kept, logged or answered back.
    const done = await mix.signIn(raw);
    if (done === null) return null;
    // The synced classes' mixes start downloading (ADR 0013 section 3).
    changed();
    return list.view();
  });
  bus.handle(CH_MIX_SIGN_OUT, async (e, raw) => {
    if (!onList(e) || raw !== undefined) return null;
    if ((await mix.signOut()) === null) return null;
    changed();
    return list.view();
  });
}
