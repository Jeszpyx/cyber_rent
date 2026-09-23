/** mulberry32: returns [value in 0..1, next seed] */
export function nextRandom(seed: number): [number, number] {
  const t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

export function rollDie(seed: number): [number, number] {
  const [value, next] = nextRandom(seed);
  return [Math.floor(value * 6) + 1, next];
}
