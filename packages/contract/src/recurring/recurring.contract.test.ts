// REC-02: форма входов и ответов регулярных платежей — владельца во входе нет, суммы только в Money, операции пачкой ≤ 100.
import { describe, expect, it } from "vitest";
import {
  MARKERS_MAX,
  RecurringCreateInput,
  RecurringEditInput,
  recurringContract,
} from "./recurring.contract.ts";

const ID = "0197f2c0-0000-7000-8000-000000000001";

describe("REC-02: вход процедур", () => {
  it("«Добавить вручную» требует название, раздел, сумму и период; лишнее поле отвергается", () => {
    const ok = {
      name: "Аренда гаража",
      section: "mandatory",
      amount: { minor: 12_000, currency: "BYN" },
      period: "month",
      anchorDay: 30,
    };
    expect(RecurringCreateInput.safeParse(ok).success).toBe(true);
    expect(RecurringCreateInput.safeParse({ ...ok, name: "  " }).success).toBe(false);
    expect(RecurringCreateInput.safeParse({ ...ok, anchorDay: 32 }).success).toBe(false);
    expect(RecurringCreateInput.safeParse({ ...ok, userId: ID }).success).toBe(false);
  });

  it("«Исправить» принимает только присланные поля и id платежа", () => {
    expect(RecurringEditInput.safeParse({ id: ID, anchorDay: 20 }).success).toBe(true);
    expect(RecurringEditInput.safeParse({ anchorDay: 20 }).success).toBe(false);
    expect(RecurringEditInput.safeParse({ id: ID, period: "decade" }).success).toBe(false);
  });

  it("признак «регулярный» — не больше 100 операций страницы за раз", () => {
    const ids = (n: number) => Array.from({ length: n }, () => ID);
    const input = recurringContract.markers["~orpc"].inputSchema;
    expect(MARKERS_MAX).toBe(100);
    expect(input?.["~standard"].validate({ ids: ids(100) })).toBeDefined();
    const over = input?.["~standard"].validate({ ids: ids(101) }) as { issues?: unknown[] };
    expect(over.issues?.length).toBeGreaterThan(0);
  });
});
