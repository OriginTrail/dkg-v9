/**
 * Helper function for integer square root (Babylonian method)
 * Used for sublinear stake scaling in RFC-26 formula
 */
export function sqrt(x: bigint): bigint {
  if (x === 0n) return 0n;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}
