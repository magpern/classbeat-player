/** The only place that reads the machine's clocks. */
export function monoMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

export function wallMs(): number {
  return Date.now();
}
