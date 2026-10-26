/** Small seeded PRNG (mulberry32) and helpers. Same seed → same demo world. */

export type Rng = {
  seed: number;
  next: () => number;
  float: (min: number, max: number) => number;
  int: (min: number, max: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  pickN: <T>(xs: readonly T[], n: number) => T[];
  chance: (p: number) => boolean;
  gauss: (mean?: number, sd?: number) => number;
  id: (prefix?: string) => string;
  fork: (salt: string | number) => Rng;
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let counter = 0;
  const r: Rng = {
    seed,
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    pickN: (xs, n) => {
      const copy = [...xs];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
    },
    chance: (p) => next() < p,
    gauss: (mean = 0, sd = 1) => {
      const u = Math.max(next(), 1e-9);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    id: (prefix = 'id') => `${prefix}_${(seed >>> 0).toString(36)}${(counter++).toString(36)}${Math.floor(next() * 1e6).toString(36)}`,
    fork: (salt) => rng((seed ^ hash(String(salt))) >>> 0),
  };
  return r;
}

export const newSeed = () => {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  } catch {
    return Math.floor(Math.random() * 2 ** 32);
  }
};

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const round = (x: number, step = 1) => Math.round(x / step) * step;
