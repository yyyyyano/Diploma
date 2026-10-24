import { describe, expect, it } from "vitest";

describe("sum: it.fails и TODO в названии — это строка", () => {
  it.each([[1, 2, 3]])("%i + %i = %i", (a, b, c) => {
    expect(a + b).toBe(c);
  });
  it("Scope нельзя собрать литералом", () => {
    // @ts-expect-error — литерал без бренда не является Scope
    const scope: Scope = { userId: "u" };
    expect(scope).toBeDefined();
  });
  // TODO(T-034): добавить округление банковское
});
