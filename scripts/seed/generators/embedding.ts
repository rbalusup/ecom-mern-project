/** Returns a random normalized 1536-dimensional unit vector. */
export function mockEmbedding(): number[] {
  const vec = Array.from({ length: 1536 }, () => Math.random() - 0.5);
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / norm);
}
