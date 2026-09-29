// Small seeded RNG (mulberry32). Same seed -> same run, so any bug report is reproducible.
// `state()` / the `resume` argument let a saved run continue drawing exactly the cards it would have drawn.

export interface Rng {
  next(): number;              // [0, 1)
  int(n: number): number;      // [0, n)
  pick<T>(items: readonly T[]): T;
  seed: number;
  state(): number;             // the generator's current position, for saving a run
}

export function makeRng(seed: number, resume?: number): Rng {
  let a = (resume ?? seed) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    int: (n) => Math.floor(next() * n),
    pick: (items) => items[Math.floor(next() * items.length)],
    state: () => a,
  };
}
