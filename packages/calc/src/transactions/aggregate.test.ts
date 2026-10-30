// FIN-01: агрегаты — переводы не входят в доходы и расходы, возврат уменьшает расходы своей категории; свойства.
import { Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { categoryTotal, groupSum, totalOf } from "./aggregate.ts";

const group = (minor: number, ids: string[] = [], count = ids.length) => ({ minor, count, ids });

describe("FIN-01: итог категории", () => {
  it("покупки 1 200,00 − возврат 200,00 = 1 000,00 в своей категории", () => {
    const result = categoryTotal(
      groupSum("transactions.expense", group(120_000, ["a", "b"]), 200),
      groupSum("transactions.refund", group(20_000, ["c"]), 200),
    );
    expect(result.value).toEqual({ minor: 100_000, currency: "BYN" });
    expect(result.trace).toMatchObject({ key: "transactions.categoryTotal", op: "sub" });
  });

  it("возвратов больше покупок — отрицательная сумма показывается как есть", () => {
    const result = categoryTotal(
      groupSum("transactions.expense", group(5_000, ["a"]), 200),
      groupSum("transactions.refund", group(8_000, ["b"]), 200),
    );
    expect(result.value.minor).toBe(-3_000);
  });

  it("без возвратов — сами покупки", () => {
    expect(
      categoryTotal(groupSum("transactions.expense", group(7_000, ["a"]), 200), undefined).value
        .minor,
    ).toBe(7_000);
  });
});

describe("EXPL-01: основания суммы группы", () => {
  it("операций больше предела: refs — первые 3, в пояснении — сколько остальных", () => {
    const leaf = groupSum("transactions.expense", group(9_000, ["a", "b", "c"], 10), 3);
    expect(leaf.trace.refs.map((ref) => ref.id)).toEqual(["a", "b", "c"]);
    expect(leaf.trace.note).toBe("ещё 7 операций");
  });

  it("все операции в refs — пояснения нет", () => {
    expect(groupSum("transactions.expense", group(1, ["a"]), 3).trace.note).toBeUndefined();
  });

  it("период без операций — ноль BYN, а не ошибка", () => {
    expect(totalOf("transactions.expense", []).value).toEqual(Money.of(0, "BYN"));
  });
});

describe("FIN-01: свойства", () => {
  const amounts = fc.array(
    fc.record({
      category: fc.constantFrom("a", "b", "c"),
      expense: fc.integer({ min: 0, max: 1_000_000 }),
      refund: fc.integer({ min: 0, max: 1_000_000 }),
    }),
    { maxLength: 30 },
  );

  /** Группы по категориям: итог категории = покупки − возвраты. */
  function totals(rows: readonly { category: string; expense: number; refund: number }[]) {
    const byCategory = new Map<string, { expense: number; refund: number }>();
    for (const row of rows) {
      const current = byCategory.get(row.category) ?? { expense: 0, refund: 0 };
      byCategory.set(row.category, {
        expense: current.expense + row.expense,
        refund: current.refund + row.refund,
      });
    }
    return [...byCategory.values()].map((sum) =>
      categoryTotal(
        groupSum("transactions.expense", group(sum.expense), 1),
        groupSum("transactions.refund", group(sum.refund), 1),
      ),
    );
  }

  it("сумма по категориям = все покупки − все возвраты", () => {
    fc.assert(
      fc.property(amounts, (rows) => {
        const total = totalOf("transactions.expense", totals(rows)).value.minor;
        const expected = rows.reduce((acc, row) => acc + row.expense - row.refund, 0);
        expect(total).toBe(expected);
      }),
    );
  });

  it("возврат уменьшает свою категорию ровно на свою сумму", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (expense, refund) => {
          const without = categoryTotal(
            groupSum("transactions.expense", group(expense), 1),
            undefined,
          ).value.minor;
          const withRefund = categoryTotal(
            groupSum("transactions.expense", group(expense), 1),
            groupSum("transactions.refund", group(refund), 1),
          ).value.minor;
          expect(without - withRefund).toBe(refund);
        },
      ),
    );
  });

  it("перестановка операций не меняет итог", () => {
    fc.assert(
      fc.property(amounts, fc.integer(), (rows, seed) => {
        const shuffled = rows.toSorted(
          (a, b) => ((a.expense * seed) % 7) - ((b.expense * seed) % 7),
        );
        expect(totalOf("x", totals(shuffled)).value.minor).toBe(
          totalOf("x", totals(rows)).value.minor,
        );
      }),
    );
  });
});
