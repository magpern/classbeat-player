// The Swedebeat sign-in channels (ADR 0013 section 1). Only the class list page may use them: the
// sender is checked first, before anything is read. A refused message gets null and changes
// nothing. The answer is the ListView, which carries the sign-in state and never a token or a
// value that was typed; nothing here logs.
import { CH_MIX_SIGN_IN, CH_MIX_SIGN_OUT } from "../../core/channels.ts";
import { MIX_PAGE } from "../../core/ipc-policy.ts";
import type { Trusted } from "../../core/ipc-policy.ts";
import type { IpcBus } from "../ipc-handlers.ts";
import { pageEvent } from "../ipc-handlers.ts";
import type { ListController } from "../list/list-controller.ts";
import type { MixService } from "./service.ts";

export function registerMixHandlers(bus: IpcBus, trusted: () => Trusted, mix: MixService, list: Pick<ListController, "view">): void {
  const onList = (e: Parameters<typeof pageEvent>[0]): boolean => pageEvent(e, trusted) === MIX_PAGE;
  bus.handle(CH_MIX_SIGN_IN, async (e, raw) => {
    if (!onList(e)) return null;
    // The service parses and refuses; `raw` is not kept, logged or answered back.
    const done = await mix.signIn(raw);
    return done === null ? null : list.view();
  });
  bus.handle(CH_MIX_SIGN_OUT, (e, raw) => {
    if (!onList(e) || raw !== undefined) return null;
    return mix.signOut() === null ? null : list.view();
  });
}
