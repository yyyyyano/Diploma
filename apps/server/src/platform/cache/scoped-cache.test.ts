// ARCHITECTURE §6.6, LLM-05: кэш пользовательских данных — ключ с домохозяйством, срок жизни по часам, предел записей.
import { FakeClock, testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { createScopedCache } from "./scoped-cache.ts";

const a = { scope: testScope({ user: 1, household: 1 }) };
const b = { scope: testScope({ user: 2, household: 2 }) };

describe("scopedCache: ключ — всегда с домохозяйством", () => {
  it("запись домохозяйства A не видна B по тому же ключу", () => {
    const cache = createScopedCache<string>({
      max: 10,
      ttlMs: 1000,
      clock: new FakeClock("2026-10-28T09:00:00Z"),
    });
    cache(a).set("ТАКСИ", "taxi");
    expect(cache(a).get("ТАКСИ")).toBe("taxi");
    expect(cache(b).get("ТАКСИ")).toBeUndefined();
  });

  it("срок жизни истёк — записи нет", () => {
    const clock = new FakeClock("2026-10-28T09:00:00Z");
    const cache = createScopedCache<string>({ max: 10, ttlMs: 1000, clock });
    cache(a).set("k", "v");
    clock.advance(999);
    expect(cache(a).get("k")).toBe("v");
    clock.advance(1);
    expect(cache(a).get("k")).toBeUndefined();
  });

  it("сверх предела вытесняется самая давняя по использованию", () => {
    const cache = createScopedCache<number>({
      max: 2,
      ttlMs: 10_000,
      clock: new FakeClock("2026-10-28T09:00:00Z"),
    });
    cache(a).set("x", 1);
    cache(a).set("y", 2);
    cache(a).get("x");
    cache(a).set("z", 3);
    expect([cache(a).get("x"), cache(a).get("y"), cache(a).get("z")]).toEqual([1, undefined, 3]);
  });
});
