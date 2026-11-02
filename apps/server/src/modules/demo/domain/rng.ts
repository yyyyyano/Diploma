// Детерминированный датчик чисел демо (DEMO-02): одно зерно — одна и та же история. Math.random() в данных демо нельзя:
// воспроизводимость проверяет тест (одинаковые зерно и дата → одинаковые данные).

/** mulberry32: [0, 1) из 32-битного зерна. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Целое от `min` до `max` включительно. */
export function between(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Один из вариантов по равным долям. */
export function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new RangeError("pick: пустой список.");
  return item;
}
