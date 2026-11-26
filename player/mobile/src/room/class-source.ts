// The room screen's only way into native code (issue #871): getClass, the one class it opens by its
// id. The room page gets this and never instructor mode's whole plugin, so it can neither switch
// mode, list, sync, unpair nor follow (modes.test.ts pins it).
import type { InstructorModePlugin } from "../modes/bridge.ts";

export interface RoomClassSource {
  /** The class saved on this phone under [id]: {document} or {error: "not_found"} (class-answer.ts). */
  getClass(args: { id: string }): Promise<unknown>;
}

/** Narrows [plugin] to getClass, passing on the id and nothing else. */
export function roomClassSource(plugin: Pick<InstructorModePlugin, "getClass">): RoomClassSource {
  return Object.freeze({ getClass: (args: { id: string }) => plugin.getClass({ id: args.id }) });
}
