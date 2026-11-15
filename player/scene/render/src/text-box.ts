// A text line's box on the window, in CSS pixels with y down: what the text layer measures and the
// mask darkens under (scene.md S2). Types only.

export interface TextBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
