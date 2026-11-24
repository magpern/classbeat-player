// The presenter's drawers (riders, sensors) open one at a time: the one that opens announces its
// name here and the other closes. Nothing but the opener's name is passed.
type Name = "riders" | "sensors";
const listeners: ((opened: Name) => void)[] = [];

export const onDrawerOpened = (cb: (opened: Name) => void): void => void listeners.push(cb);
export const announceDrawer = (opened: Name): void => listeners.forEach((cb) => cb(opened));
