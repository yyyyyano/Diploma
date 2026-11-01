// AFF-05, AFF-06 на Postgres с настоящими соседями (recurring, fin, norm-tables): безопасный платёж по ПДН (пример SPEC: доход
// 3 200, по кредитам 800, предел 40 % → 1 280 → до 480), предел 50 % для белорусских товаров, сумма кредита по ставке и сроку,
// «нет подтверждённого предела» до «Подтвердить», платежи выше предела, доход называет человек, без банков и программ в ответе (P6).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affordWithJournal, clock } from "../../../main/__fixtures__/afford-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const byn = (minor: number) => ({ minor, currency: "BYN" }) as const;
const TODAY = "2026-10-28";
const JUL_OCT = ["2026-07", "2026-08", "2026-09", "2026-10"];

interface Series {
  merchant: string;
  type: "income" | "expense";
  category: string;
  day: number;
  minor: number;
}

/** Пример AFF-05: доход 3 200, по кредитам уже уходит 800. */
const PDN_EXAMPLE: readonly Series[] = [
  { merchant: "ТехноСофт", type: "income", category: "salary", day: 5, minor: 320_000 },
  { merchant: "Банк кредит", type: "expense", category: "loans", day: 23, minor: 80_000 },
];

async function setup(series: readonly Series[] = PDN_EXAMPLE) {
  clock.set(`${TODAY}T09:00:00Z`);
  const a = affordWithJournal(db);
  const s = a.s();
  const ops = JUL_OCT.flatMap((month) =>
    series.map((item) => ({
      date: `${month}-${String(item.day).padStart(2, "0")}`,
      merchant: item.merchant,
      type: item.type,
      amountMinor: item.minor,
      category: item.category,
    })),
  );
  await a.r.seed(s, ops as never);
  await a.r.recompute(s);
  return { a, s };
}

describe("AFF-05, AFF-06: безопасный платёж по ПДН", () => {
  it("пределы не подтверждены — «нет подтверждённого предела»: ни платежа, ни нуля; доход и платежи по кредитам показаны", async () => {
    const { a, s } = await setup();
    const result = await a.safeLoan(s, {});
    expect(result).toMatchObject({
      status: "no-limit",
      missing: ["pdn.limit.default"],
      limitPercent: null,
      safePayment: null,
      limitAmount: null,
      maxLoan: null,
      exceeded: false,
    });
    expect(result.income?.amount).toEqual(byn(320_000));
    expect(result.currentPayments?.amount).toEqual(byn(80_000));
    expect(result.incomeSource).toBe("history");
    const domestic = await a.safeLoan(s, { domesticGoods: true });
    expect(domestic).toMatchObject({ status: "no-limit", missing: ["pdn.limit.domestic-goods"] });
  });
});

describe("AFF-05: безопасный платёж после «Подтвердить»", () => {
  let confirmedDb: TestDb;
  beforeAll(async () => {
    confirmedDb = await createTestDb();
  });
  afterAll(async () => {
    await confirmedDb.drop();
  });

  async function confirmed(series: readonly Series[] = PDN_EXAMPLE) {
    clock.set(`${TODAY}T09:00:00Z`);
    const a = affordWithJournal(confirmedDb);
    await a.confirmPdn();
    const s = a.s();
    const ops = JUL_OCT.flatMap((month) =>
      series.map((item) => ({
        date: `${month}-${String(item.day).padStart(2, "0")}`,
        merchant: item.merchant,
        type: item.type,
        amountMinor: item.minor,
        category: item.category,
      })),
    );
    await a.r.seed(s, ops as never);
    await a.r.recompute(s);
    return { a, s };
  }

  it("пример SPEC: доход 3 200, кредиты 800, предел 40 % → 1 280 → новый платёж до 480; каждое число с traceId", async () => {
    const { a, s } = await confirmed();
    const result = await a.safeLoan(s, {});
    expect(result).toMatchObject({ status: "ok", limitPercent: 40, exceeded: false });
    expect(result.income?.amount).toEqual(byn(320_000));
    expect(result.currentPayments?.amount).toEqual(byn(80_000));
    expect(result.limitAmount?.amount).toEqual(byn(128_000));
    expect(result.safePayment?.amount).toEqual(byn(48_000));
    const saved = await a.r.t.explain.get(s, result.safePayment?.traceId as never);
    expect(saved.trace.key).toBe("afford.safePayment");
    expect(saved.trace.inputs.map((input) => input.key)).toEqual([
      "afford.pdnLimitAmount",
      "afford.currentPayments",
    ]);
    // Предел в трассе ведёт к строке таблицы ставок: «подтвердил: администратор».
    const limitNode = saved.trace.inputs[0]?.inputs[1];
    expect(limitNode?.key).toBe("afford.pdnLimit");
    expect(limitNode?.note).toContain("подтвердил: администратор");
  });

  it("кредит на белорусские товары: предел 50 % → 1 600 → платёж до 800", async () => {
    const { a, s } = await confirmed();
    const result = await a.safeLoan(s, { domesticGoods: true });
    expect(result).toMatchObject({ status: "ok", limitPercent: 50, domesticGoods: true });
    expect(result.safePayment?.amount).toEqual(byn(80_000));
  });

  it("ставка 14 % и срок 5 лет: платёж 480 → кредит до 20 628,96; ставка и срок — в ответе", async () => {
    const { a, s } = await confirmed();
    const result = await a.safeLoan(s, { rateBp: 1400, months: 60 });
    expect(result.maxLoan).toMatchObject({ rateBp: 1400, months: 60 });
    expect(result.maxLoan?.amount.amount).toEqual(byn(2_062_896));
    const saved = await a.r.t.explain.get(s, result.maxLoan?.amount.traceId as never);
    expect(saved.trace.key).toBe("afford.maxLoan");
  });

  it("платежи уже выше предела: запаса нет — safePayment null и exceeded, а не отрицательное число", async () => {
    const { a, s } = await confirmed(
      PDN_EXAMPLE.map((item) => (item.category === "loans" ? { ...item, minor: 150_000 } : item)),
    );
    const result = await a.safeLoan(s, { rateBp: 1400, months: 60 });
    expect(result).toMatchObject({
      status: "ok",
      safePayment: null,
      exceeded: true,
      maxLoan: null,
    });
    expect(result.limitAmount?.amount).toEqual(byn(128_000));
  });

  it("регулярного дохода нет: no-income; назвал доход 3 000 — оценка по его слову, платежи по кредитам из истории", async () => {
    const { a, s } = await confirmed(PDN_EXAMPLE.filter((item) => item.type === "expense"));
    expect(await a.safeLoan(s, {})).toMatchObject({
      status: "no-income",
      income: null,
      safePayment: null,
    });
    const named = await a.safeLoan(s, { income: byn(300_000) });
    expect(named).toMatchObject({ status: "ok", incomeSource: "user" });
    // 300 000 × 40 % = 120 000; минус кредиты 80 000 = 40 000.
    expect(named.safePayment?.amount).toEqual(byn(40_000));
  });

  it("кредитов нет — платежи 0, весь предел свободен; ставка без срока — VALIDATION", async () => {
    const { a, s } = await confirmed(PDN_EXAMPLE.filter((item) => item.type === "income"));
    const result = await a.safeLoan(s, {});
    expect(result.currentPayments?.amount).toEqual(byn(0));
    expect(result.safePayment?.amount).toEqual(byn(128_000));
    await expect(a.safeLoan(s, { rateBp: 1400 })).rejects.toMatchObject({
      code: "VALIDATION",
      params: { field: "months" },
    });
    await expect(a.safeLoan(s, { income: byn(0) })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("в ответе нет названий банков и программ (P6): контрагент кредитного платежа не попадает в результат", async () => {
    const { a, s } = await confirmed();
    const text = JSON.stringify(await a.safeLoan(s, { rateBp: 1400, months: 60 }));
    for (const name of ["Банк", "ТехноСофт"]) expect(text).not.toContain(name);
  });
});
