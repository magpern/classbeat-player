// The room screen's page, room.html, in instructor mode only (issue #630): the desktop's room screen (the web lane's 2D screen and the player's
// band), bundled into the app and drawn from the fake room (fake-room.ts). Import order matters:
// the stand-in is installed before the room screen's module runs.
import "./install.ts";
import "../../app/src/renderer/room.ts";
