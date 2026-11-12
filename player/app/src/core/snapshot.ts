// What the shell sends the presenter: the open class, the clock view and the last error. Pure.
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import type { ClockView } from "./clock/view.ts";

export interface FileError {
  readonly message: string;
  readonly details: readonly string[];
}

export interface Snapshot {
  /** Increases by one each time a class is opened; 0 before the first. */
  readonly loadId: number;
  readonly fileName: string | null;
  readonly doc: Class | null;
  readonly view: ClockView | null;
  readonly error: FileError | null;
}

export const EMPTY_SNAPSHOT: Snapshot = { loadId: 0, fileName: null, doc: null, view: null, error: null };
