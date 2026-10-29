// Deterministic random + noise helpers. Every procedural placement in the chapter
// is seeded so the world is identical on every load.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer-lattice hash in [0, 1)
export function hash2(x: number, z: number, seed: number = 0): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((z | 0) + seed * 374761393, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

// Smooth value noise in [0, 1)
export function valueNoise2(x: number, z: number, seed: number = 0): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = smooth(x - xi), zf = smooth(z - zi);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * zf;
}

export function fbm2(x: number, z: number, seed: number = 0, octaves: number = 4): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * f, z * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number) => smooth(clamp01((v - a) / (b - a)));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Frame-rate independent exponential approach factor
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
