// The presenter window's size, in content-area pixels (docs/design/presenter.md, "Minimum size").
// Pure data: the window is built from it in main.ts, and tests read it.
export const PRESENTER_SIZE = {
  width: 1000,
  height: 760,
  minWidth: 1000,
  minHeight: 720,
  useContentSize: true,
} as const;
