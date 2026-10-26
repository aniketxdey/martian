import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.MARTIAN_SERVICE ?? "mcp" },
  redact: ["token", "password", "secrets", "*.password", "*.secret", "headers.authorization"],
});

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function p95(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))];
}

export const round1 = (v: number) => Math.round(v * 10) / 10;

export const daysSince = (d: Date | string | undefined | null): number =>
  d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : 0;

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Deterministic PRNG for sandbox data. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const tagsToRecord = (tags?: { Key?: string; Value?: string }[]) =>
  Object.fromEntries((tags ?? []).filter((t) => t.Key).map((t) => [t.Key as string, t.Value ?? ""]));
