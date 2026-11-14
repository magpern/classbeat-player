'use strict';
// godot-native in one-screen mode only (Electron edge, no rules): Godot's full screen window is on
// top of the room window, so the controls overlay is a frameless, transparent window the size of the
// display, above Godot's. It draws only the overlay; the class view underneath is never resized.
const path = require('node:path');

function createOverlay({ BrowserWindow, webPreferences, guard, bounds }) {
  const win = new BrowserWindow({
    ...bounds, frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false,
    title: 'Overlay', webPreferences: webPreferences(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true }); // click-through until the overlay is shown
  guard(win);
  win.loadFile(path.join(__dirname, 'band.html'));
  return win;
}

module.exports = { createOverlay };
