// IPC channel names shared by the shell, the preload script and the presenter. Pure constants.
export const CH_STATE = "player:state";
export const CH_COMMAND = "player:command";
export const CH_OPEN_DROPPED = "player:open-dropped";
export const CH_UPDATE = "player:update";
// Pairing: start, read the state, unpair. No argument is taken; the answer is a PairingView.
export const CH_PAIRING_START = "player:pairing-start";
export const CH_PAIRING_STATE = "player:pairing-state";
export const CH_UNPAIR = "player:unpair";
export const CH_PAIRING_REOPEN = "player:pairing-reopen";
// The class list window (docs/design/class-list.md). `list-view` takes no argument; `list-start`
// takes a class's id and hash; the others take none.
export const CH_LIST_VIEW = "list:view";
export const CH_LIST_START = "list:start";
export const CH_LIST_OPEN_FILE = "list:open-file";
export const CH_LIST_DISMISS = "list:dismiss-error";
export const CH_LIST_BACK = "list:back";
// The room screen's window (docs/design/room-2d.md): `room:state` takes no argument and answers
// with a RoomFrame; `room:update` is the shell's push of the same. Nothing else is the room's.
export const CH_ROOM_STATE = "room:state";
export const CH_ROOM_UPDATE = "room:update";
// The room window's controls (room-2d.md, What the room window needs from the desktop shell).
// `room:command` takes one of the room's clock commands (core/room/commands.ts); `room:end`,
// `room:remote-state`, `room:remote-start` and `room:remote-stop` take no argument. The answers and
// `room:remote-update`, the shell's push, carry the phone remote's slot (core/room/remote.ts).
export const CH_ROOM_COMMAND = "room:command";
export const CH_ROOM_END = "room:end";
export const CH_ROOM_REMOTE_STATE = "room:remote-state";
export const CH_ROOM_REMOTE_START = "room:remote-start";
export const CH_ROOM_REMOTE_STOP = "room:remote-stop";
export const CH_ROOM_REMOTE_UPDATE = "room:remote-update";
// The presenter's phone-remote panel (ADR 0005): `live:view`, `live:start`, `live:end` and
// `live:code` take no argument; `live:drop` takes a phone's place, 1 or 2. Each answers with a
// LivePanelView. They are the presenter page's only: the room window has no way to them.
export const CH_LIVE_VIEW = "live:view";
export const CH_LIVE_START = "live:start";
export const CH_LIVE_END = "live:end";
export const CH_LIVE_CODE = "live:code";
export const CH_LIVE_DROP = "live:drop";
