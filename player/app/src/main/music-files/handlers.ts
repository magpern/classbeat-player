// The local music files channels (ADR 0017 section 2; owner's settlement on #920). Only the
// instructor's class list page may use them, never the room window or the presenter: the sender is
// checked first, before anything is read. A refused message gets null and changes nothing.
// `player:music-files-find` takes a class id only; `player:music-files-find-cancel` takes nothing.
// A handler never throws, as Electron would pass the error's text to the page: a fault answers the
// fixed `failed`, which names nothing of the disk. Nothing here logs.
import { CH_MUSIC_FILES_FIND, CH_MUSIC_FILES_FIND_CANCEL } from "../../core/channels.ts";
import { MUSIC_FILES_PAGE } from "../../core/ipc-policy.ts";
import type { Trusted } from "../../core/ipc-policy.ts";
import { FAILED } from "../../core/music-files/answer.ts";
import { isClassId } from "../../core/sync/answers.ts";
import type { IpcBus } from "../ipc-handlers.ts";
import { pageEvent } from "../ipc-handlers.ts";
import type { MusicFiles } from "./service.ts";

export function registerMusicFilesHandlers(bus: IpcBus, trusted: () => Trusted, music: Pick<MusicFiles, "find" | "cancel">): void {
  const onList = (e: Parameters<typeof pageEvent>[0]): boolean => pageEvent(e, trusted) === MUSIC_FILES_PAGE;
  bus.handle(CH_MUSIC_FILES_FIND, async (e, raw) => {
    if (!onList(e) || typeof raw !== "string" || !isClassId(raw)) return null;
    try {
      return await music.find(raw);
    } catch {
      return FAILED;
    }
  });
  bus.handle(CH_MUSIC_FILES_FIND_CANCEL, (e, raw) => {
    if (!onList(e) || raw !== undefined) return null;
    try {
      return music.cancel();
    } catch {
      return false;
    }
  });
}
