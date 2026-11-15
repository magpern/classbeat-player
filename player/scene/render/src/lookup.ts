// The only ways src/ reads by an index or a key held in a variable. A computed member access with a
// non-literal key is banned in src/ (eslint.config.js): a key built at run time can name any member,
// `constructor` included. `lookup` takes a key typed as one of the table's own keys and matches by
// equality over the table's own entries, so no prototype member can ever be returned.

/** The value of `table` at `key`; throws if a table lacks a key its type promises. */
export function lookup<K extends string | number, V>(table: Readonly<Record<K, V>>, key: K): V {
  const found = Object.entries<V>(table).find(([name]) => name === String(key));
  if (found === undefined) throw new RangeError(`no entry for ${key}`);
  return found[1];
}

/** `list[index]` for a non-negative integer index (`Array.at` would count a negative one from the end). */
export function nth<T>(list: readonly T[], index: number): T | undefined {
  return index >= 0 ? list.at(index) : undefined;
}
