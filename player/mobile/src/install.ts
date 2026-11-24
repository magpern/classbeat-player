// Runs before the room screen's module (main.ts imports it first), so `window.room` exists when
// the room screen reads it.
import { installFakeRoom } from "./fake-room.ts";

installFakeRoom();
