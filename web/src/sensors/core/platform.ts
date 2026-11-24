// Which words the "cannot connect" sheet uses (docs/design/sensors.md, "unsupported"). Pure: the
// caller passes what the browser says about itself. An iPad says "Macintosh" but has touch points.
export interface Agent {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
}

export function isIphone(a: Agent): boolean {
  return /iPhone|iPad|iPod/.test(a.userAgent) || (/Macintosh/.test(a.userAgent) && a.maxTouchPoints > 1);
}
