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
