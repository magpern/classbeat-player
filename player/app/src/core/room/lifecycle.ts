// When the room screen's window closes, and when the presenter's "Show the room screen" may open
// it again. Pure: the shell passes where the instructor is and whether a class is pinned.

/**
 * Whether the room window closes now. The class is closed once the instructor is on the class list
 * with no class pinned: a pinned class can be gone back to ("Back to the class"), a class that has
 * ended or came from a file cannot. While the presenter shows, the room stays, on "Class Complete"
 * after the end.
 */
export const roomCloses = (onList: boolean, pinned: boolean): boolean => onList && !pinned;

/**
 * Whether "Show the room screen" (the File menu) opens the room window: a class is open and is not
 * closed (`roomCloses`). It reopens a window closed by hand, for a pinned class or one from a file.
 */
export const roomMayOpen = (hasClass: boolean, onList: boolean, pinned: boolean): boolean => hasClass && !roomCloses(onList, pinned);
