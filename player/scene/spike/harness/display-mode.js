'use strict';
// Pure rule: one-screen or two-screen layout. The studio has one screen mirrored on the projector,
// so one display (the default) means one-screen: the room goes full screen on it and the controls
// are a band over it. Two or more displays keep the second-display layout.
//   count   number of displays
//   forced  'one' | 'two' (SPIKE_DISPLAY_MODE), wins over everything
//   sized   a windowed test size was given (SPIKE_ROOM_SIZE): the old windowed layout, unchanged
function chooseDisplayMode({ count, forced, sized }) {
  if (forced === 'one' || forced === 'two') return forced;
  if (sized) return 'two';
  return count <= 1 ? 'one' : 'two';
}

module.exports = { chooseDisplayMode };
