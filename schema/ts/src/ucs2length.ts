// Same function as ajv/dist/runtime/ucs2length: string length in code points, for minLength and
// maxLength. Local so the reader bundle needs no CommonJS require.
export default function ucs2length(str: string): number {
  const len = str.length;
  let length = 0;
  let pos = 0;
  while (pos < len) {
    length++;
    const value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      if ((str.charCodeAt(pos) & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}
