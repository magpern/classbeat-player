export const INK: number;
export interface InkResult {
  box: { x0: number; y0: number; x1: number; y1: number };
  worst: number;
}
export default function ink(args: [string, string, number[][], number]): Promise<InkResult | null>;
