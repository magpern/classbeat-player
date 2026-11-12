'use strict';
// Pure rule: does the Godot window have to be started again because the room's display changed?
// `launchedOn` is the bounds Godot was (or is being) launched on, or null when no Godot is
// running or starting. The Godot window cannot be moved from outside, so a different display
// means a new launch there; the same display, or no Godot at all, means nothing to do.
function needsRestart(launchedOn, target) {
  if (!launchedOn || !target) return false;
  return ['x', 'y', 'width', 'height'].some((k) => launchedOn[k] !== target[k]);
}

module.exports = { needsRestart };
