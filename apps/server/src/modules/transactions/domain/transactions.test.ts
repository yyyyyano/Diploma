// TXN-03, STMT-02: направление по типу, сдвиг остатков от создания, правки, переноса и удаления, поля истории.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import {
  balanceDeltas,
  changedFields,
  directionOf,
  shortTime,
  type Snapshot,
} from "./transactions.ts";

const byn = (minor: number) => Money.of(minor, "BYN");

describe("TXN-03: направление движения денег", () => {
  it("расход уводит со счёта, доход и возврат приводят, перевод — как выбрали (по умолчанию со счёта)", () => {
    expect(directionOf("expense", "in")).toBe("out");
    expect(directionOf("income")).toBe("in");
    expect(directionOf("refund")).toBe("in");
    expect(directionOf("transfer")).toBe("out");
    expect(directionOf("transfer", "in")).toBe("in");
  });
});

describe("STMT-02: сдвиг остатков", () => {
  it("новый расход 6,50 уменьшает остаток «Наличных» на 6,50", () => {
    const deltas = balanceDeltas([], [{ accountId: "cash", amount: byn(650), direction: "out" }]);
    expect(deltas).toEqual(new Map([["cash", byn(-650)]]));
  });

  it("правка расхода 6,50 → 8,00 сдвигает остаток ещё на −1,50", () => {
    const deltas = balanceDeltas(
      [{ accountId: "cash", amount: byn(650), direction: "out" }],
      [{ accountId: "cash", amount: byn(800), direction: "out" }],
    );
    expect(deltas).toEqual(new Map([["cash", byn(-150)]]));
  });

  it("перенос дохода 100 на другой счёт: −100 у прежнего, +100 у нового", () => {
    const deltas = balanceDeltas(
      [{ accountId: "a", amount: byn(10_000), direction: "in" }],
      [{ accountId: "b", amount: byn(10_000), direction: "in" }],
    );
    expect(deltas).toEqual(
      new Map([
        ["a", byn(-10_000)],
        ["b", byn(10_000)],
      ]),
    );
  });

  it("удаление возврата 24,90 уменьшает остаток; правка без смены суммы и счёта сдвигов не даёт", () => {
    expect(balanceDeltas([{ accountId: "a", amount: byn(2490), direction: "in" }], [])).toEqual(
      new Map([["a", byn(-2490)]]),
    );
    const same = { accountId: "a", amount: byn(2490), direction: "in" as const };
    expect(balanceDeltas([same], [same]).size).toBe(0);
  });
});

describe("TXN-05: что изменилось", () => {
  const base: Snapshot = {
    accountId: "a",
    type: "expense",
    direction: "out",
    occurredOn: "2026-10-21",
    occurredTime: "08:47:00",
    amountMinor: 650,
    currency: "BYN",
    amountBynMinor: 650,
    fxRateId: null,
    merchantName: "Кофейня",
    merchantKey: "КОФЕЙНЯ",
    note: null,
    categoryCode: "cafes",
    categoryId: null,
    categorySource: "user",
  };

  it("одинаковые — ничего; иначе поля в порядке карточки", () => {
    expect(changedFields(base, base)).toEqual([]);
    expect(
      changedFields(base, {
        ...base,
        accountId: "b",
        type: "income",
        direction: "in",
        occurredOn: "2026-10-22",
        occurredTime: null,
        amountMinor: 700,
        amountBynMinor: 700,
        merchantName: null,
        note: "кофе",
        categoryCode: null,
        categoryId: "c",
      }),
    ).toEqual([
      "account",
      "type",
      "date",
      "time",
      "amount",
      "amountInByn",
      "merchant",
      "note",
      "category",
    ]);
  });

  it("время из БД «08:47:00» показывается как «08:47»", () => {
    expect(shortTime("08:47:00")).toBe("08:47");
    expect(shortTime(null)).toBeNull();
  });
});
