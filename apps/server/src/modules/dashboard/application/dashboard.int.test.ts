// DASH-01…04, EXPL-01, REC-03, BUD-02 на Postgres: главный экран на синтетической истории за 6 месяцев (@kosht/synth) с
// настоящими transactions, accounts, fin, budgets, recurring и explain. Каждое число — с traceId сохранённого расчёта;
// свободный остаток — за три полных месяца независимо от периода; новый пользователь — «первые шаги» (hasData: false).
import { Money } from "@kosht/kernel";
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  budgetsWithJournal,
  clock,
  newScope,
} from "../../../main/__fixtures__/budgets-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const TODAY = "2026-10-28";
const day = (text: string) => LocalDate.parse(text);
const byn = (minor: number) => Money.of(minor, "BYN");

/** Сценарий с историей за 6 месяцев, найденными регулярными платежами, лимитом на «Кафе» и копилкой. */
async function withHistory() {
  clock.set(`${TODAY}T09:00:00Z`);
  const b = budgetsWithJournal(db);
  const s = newScope(db);
  const history = b.r.generateHistory({ seed: 7, today: TODAY });
  await b.r.seed(s, history.operations);
  await b.r.recompute(s);
  await b.limits.set(s, { categoryKey: "system:cafes" as never, limit: byn(50_000) }, "web");
  await b.goals.create(
    s,
    { name: "Отпуск", kind: "piggy", target: byn(300_000), deadline: "2027-06-01" } as never,
    "web",
  );
  return { b, s };
}

describe("DASH-02, EXPL-01: числа периода и их расчёты", () => {
  it("октябрь: доходы, расходы, категории (≤ 6 + «Остальное»), шесть месяцев динамики — у каждого числа свой расчёт", async () => {
    const { b, s } = await withHistory();
    const view = await b.dashboard.view(s, { from: day("2026-10-01"), to: day("2026-10-31") });
    expect(view.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(view.hasData).toBe(true);
    expect(view.income.amount.minor).toBeGreaterThan(0);
    expect(view.expense.amount.minor).toBeGreaterThan(0);
    expect(view.categories.rows.length).toBeLessThanOrEqual(6);
    const rows = view.categories.rows.map((row) => row.amount.minor);
    expect(rows).toEqual(rows.toSorted((a, c) => c - a));
    // Ряды + «Остальное» — это все расходы категорий с положительной суммой.
    const restMinor = view.categories.other?.amount.minor ?? 0;
    expect(rows.reduce((sum, minor) => sum + minor, 0) + restMinor).toBeGreaterThanOrEqual(
      view.expense.amount.minor,
    );
    expect(view.months.map((m) => m.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    const october = view.months.at(-1);
    expect(october?.expense.amount).toEqual(view.expense.amount);
    // EXPL-01: расход периода объясняется сохранённой трассой с операциями-основаниями.
    const stored = await b.r.t.explain.get(s, view.expense.traceId);
    expect(stored.trace).toMatchObject({ key: "transactions.expense", op: "sum" });
    const other = view.categories.other;
    const otherTrace = other === null ? undefined : await b.r.t.explain.get(s, other.traceId);
    expect(otherTrace?.trace.key).toBe(other === null ? undefined : "dashboard.otherCategories");
  }, 90_000);

  it("повторный запрос — те же traceId, строк в explanations не прибавляется", async () => {
    const { b, s } = await withHistory();
    const input = { from: day("2026-10-01"), to: day("2026-10-31") };
    const first = await b.dashboard.view(s, input);
    const count = async () =>
      Number(
        (
          await db.owner.query<{ n: string }>(
            "select count(*)::text as n from explanations where household_id = $1",
            [s.scope.householdId],
          )
        ).rows[0]?.n,
      );
    const before = await count();
    const second = await b.dashboard.view(s, input);
    expect(second.expense.traceId).toBe(first.expense.traceId);
    expect(second.months.map((m) => m.income.traceId)).toEqual(
      first.months.map((m) => m.income.traceId),
    );
    expect(await count()).toBe(before);
  }, 90_000);

  it("свободный остаток — за три полных месяца и не зависит от периода: сентябрь и октябрь дают то же число и расчёт", async () => {
    const { b, s } = await withHistory();
    const october = await b.dashboard.view(s, { from: day("2026-10-01"), to: day("2026-10-31") });
    const september = await b.dashboard.view(s, { from: day("2026-09-01"), to: day("2026-09-30") });
    expect(october.freeBalance.months).toBe(3);
    expect(october.freeBalance.amount).not.toBeNull();
    expect(september.freeBalance).toEqual(october.freeBalance);
    expect(september.expense.amount).not.toEqual(october.expense.amount);
    expect(september.months.at(-1)?.month).toBe("2026-09");
  }, 90_000);

  it("остатки счетов: «Наличные» с названием, всего на счетах — сумма эквивалентов в BYN с расчётом", async () => {
    const { b, s } = await withHistory();
    const view = await b.dashboard.view(s, {});
    expect(view.accounts.items.length).toBeGreaterThanOrEqual(1);
    const converted = view.accounts.items.flatMap((item) =>
      item.balanceInByn === null ? [] : [item.balanceInByn.minor],
    );
    expect(view.accounts.total?.amount.minor).toBe(
      converted.reduce((sum, minor) => sum + minor, 0),
    );
    const trace = await b.r.t.explain.get(s, view.accounts.total?.traceId ?? "");
    expect(trace.trace.key).toBe("accounts.total");
  }, 90_000);
});

describe("DASH-02, BUD-02, REC-03: лимиты, цели и ближайшие платежи", () => {
  it("лимит «Кафе» и копилка приходят с процентом и traceId; ближайшие платежи — расходы на 30 дней вперёд, не больше пяти", async () => {
    const { b, s } = await withHistory();
    const view = await b.dashboard.view(s, {});
    expect(view.limits).toHaveLength(1);
    expect(view.limits[0]).toMatchObject({ categoryKey: "system:cafes", limit: byn(50_000) });
    expect(view.limits[0]?.traceId).toBeTruthy();
    expect(view.goals).toHaveLength(1);
    expect(view.goals[0]).toMatchObject({ name: "Отпуск", saved: byn(0) });
    expect(view.upcoming.length).toBeGreaterThan(0);
    expect(view.upcoming.length).toBeLessThanOrEqual(5);
    for (const payment of view.upcoming) {
      expect(payment.on >= TODAY).toBe(true);
      expect(payment.on <= "2026-11-27").toBe(true);
    }
    expect(view.upcoming.map((p) => p.on)).toEqual(view.upcoming.map((p) => p.on).toSorted());
  }, 90_000);
});

describe("DASH-04: новый пользователь", () => {
  it("без операций, лимитов и целей — hasData: false, суммы нулевые, свободного остатка нет (причина, не 0)", async () => {
    clock.set(`${TODAY}T09:00:00Z`);
    const b = budgetsWithJournal(db);
    const view = await b.dashboard.view(newScope(db), {});
    expect(view.hasData).toBe(false);
    expect(view.income.amount).toEqual(byn(0));
    expect(view.expense.amount).toEqual(byn(0));
    expect(view.categories).toEqual({ rows: [], other: null });
    expect(view.freeBalance).toMatchObject({ amount: null, reason: "insufficient-history" });
    expect(view.months).toHaveLength(6);
    expect(view.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  }, 30_000);

  it("период наоборот (from позже to) — VALIDATION", async () => {
    clock.set(`${TODAY}T09:00:00Z`);
    const b = budgetsWithJournal(db);
    await expect(
      b.dashboard.view(newScope(db), { from: day("2026-10-20"), to: day("2026-10-01") }),
    ).rejects.toBeInstanceOf(AppError);
  }, 30_000);

  it("чужое домохозяйство: данные первого не видны", async () => {
    const { b } = await withHistory();
    const view = await b.dashboard.view(newScope(db), {
      from: day("2026-10-01"),
      to: day("2026-10-31"),
    });
    expect(view.hasData).toBe(false);
    expect(view.expense.amount).toEqual(byn(0));
    expect(view.limits).toEqual([]);
  }, 90_000);
});
