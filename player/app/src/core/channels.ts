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
// Swedebeat sign-in and sign-out on the class list page (ADR 0013 section 1, docs/design/swedebeat.md).
// `player:mix-sign-in` takes what was typed, by the field names the source declares, each at most
// 256 characters; `player:mix-sign-out` takes no argument. Each answers with the ListView, never a
// token or anything typed. The class list page's only: the presenter and the room have no way to them.
export const CH_MIX_SIGN_IN = "player:mix-sign-in";
export const CH_MIX_SIGN_OUT = "player:mix-sign-out";
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
// Mix playback in the room window (ADR 0013 section 5): `room:mix` is the shell's push of a MixCue
// (core/mix/audio-cue.ts) for the window's one <audio>; `room:mix-report` takes the window's
// AudioReport (four fields, parsed strictly) and answers true, or null when refused.
export const CH_ROOM_MIX = "room:mix";
export const CH_ROOM_MIX_REPORT = "room:mix-report";
// The presenter's phone-remote panel (ADR 0005): `live:view`, `live:start`, `live:end` and
// `live:code` take no argument; `live:drop` takes a phone's place, 1 or 2. Each answers with a
// LivePanelView. They are the presenter page's only: the room window has no way to them.
export const CH_LIVE_VIEW = "live:view";
export const CH_LIVE_START = "live:start";
export const CH_LIVE_END = "live:end";
export const CH_LIVE_CODE = "live:code";
export const CH_LIVE_DROP = "live:drop";
// The presenter's riders panel (ADR 0007 sections 3 and 4): `live:riders` and `live:new-code` take
// no argument, `live:drop-rider` a rider's id, `live:lock` true or false. Each answers with a
// RidersView, the only place the riders' nicknames leave the main process. Presenter page only.
export const CH_LIVE_RIDERS = "live:riders";
export const CH_LIVE_DROP_RIDER = "live:drop-rider";
export const CH_LIVE_LOCK = "live:lock";
export const CH_LIVE_NEW_CODE = "live:new-code";
