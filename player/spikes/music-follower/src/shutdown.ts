/** Exit at once on q or Ctrl+C, even while a read is pending. A second call exits without waiting. */
export function makeShutdown(finalize: () => void, exit: (code: number) => void): () => void {
  let started = false;
  return () => {
    if (started) return exit(0);
    started = true;
    try {
      finalize();
    } catch {
      // the log may be unwritable; still leave
    }
    exit(0);
  };
}
