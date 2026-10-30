// REC-01: пересчёт по transactions.changed схлопывается по пользователю, а не по нагрузке; очередь — своя у recurring.
import { makeScope } from "@kosht/kernel";
import { testHouseholdId, testUserId } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { onTransactionsChanged } from "./on-transactions-changed.ts";

const scope = (n: number) => makeScope({ userId: testUserId(n), householdId: testHouseholdId(n) });
const ids = (n: number) => ({ ids: [`0199f0a0-0000-7000-8000-00000000000${n}`] });

describe("REC-01: подписка на transactions.changed", () => {
  const { job, module } = onTransactionsChanged(async () => []);

  it("своя очередь модуля recurring", () => {
    expect(job.name).toBe("evt.transactions.changed.recurring");
    expect(module).toBe("recurring");
  });

  it("два события одного пользователя с разными id — один ключ (пересчёт перечитывает всё)", () => {
    const { options } = job;
    expect(options.singletonKey?.(ids(1), scope(1))).toBe(options.singletonKey?.(ids(2), scope(1)));
  });

  it("у другого домохозяйства — другой ключ: чужое событие не гасит задачу", () => {
    const { options } = job;
    expect(options.singletonKey?.(ids(1), scope(1))).not.toBe(
      options.singletonKey?.(ids(1), scope(2)),
    );
  });

  it("с короткой задержкой, чтобы импорт на сотни операций дал один пересчёт", () => {
    expect(job.options.startAfterSeconds).toBe(2);
  });
});
