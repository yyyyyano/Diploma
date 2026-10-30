// BUD-01…07, P5, AGT-07 на Postgres: пороги 80/100 % лимитов (КП BUD), цели — копилка и привязка к счёту, рекомендуемый
// взнос, «отстаёт от графика», «Отменить» и «Да/Нет» через настоящий журнал actions, расходы — настоящие операции
// transactions, остатки — accounts, свободный остаток — fin. Время — FakeClock (28.10.2026).
import { Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  budgetsWithJournal,
  clock,
  newScope,
} from "../../../main/__fixtures__/budgets-with-journal.ts";
import { CategoryKey } from "@kosht/contract";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const TODAY = "2026-10-28";
const byn = (minor: number) => Money.of(minor, "BYN");
const CAFE = CategoryKey.parse("system:cafes");

function fresh(day = TODAY) {
  clock.set(`${day}T09:00:00Z`);
  const b = budgetsWithJournal(db);
  return { b, s: newScope(db) };
}

const limitNotices = (b: ReturnType<typeof fresh>["b"]) =>
  b.notices.filter((n) => n.kind === "limit");

describe("BUD-03 (КП): пороги лимита — по одному разу на порог в месяц", () => {
  it("лимит 200, траты 160 → 80 % и одно уведомление; повторная проверка второго не шлёт", async () => {
    const { b, s } = fresh();
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    await b.spend(s, "2026-10-05", 16_000);
    expect(await b.thresholds.recheckLimits(s)).toBe(1);
    expect(await b.thresholds.recheckLimits(s)).toBe(0);
    expect(limitNotices(b)).toHaveLength(1);
    expect(limitNotices(b)[0]).toMatchObject({
      params: { threshold: 80, percent: 80, category: "system:cafes", daysLeft: 4 },
    });
    const [limit] = (await b.overview.view(s)).limits;
    expect(limit).toMatchObject({ percent: 80, spent: byn(16_000), remaining: byn(4_000) });
  }, 30_000);

  it("траты до 205 → второе уведомление (100 %); после него ничего больше", async () => {
    const { b, s } = fresh();
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    await b.spend(s, "2026-10-05", 16_000);
    await b.thresholds.recheckLimits(s);
    await b.spend(s, "2026-10-20", 4_500);
    expect(await b.thresholds.recheckLimits(s)).toBe(1);
    expect(await b.thresholds.recheckLimits(s)).toBe(0);
    expect(limitNotices(b).map((n) => (n.params as { threshold: number }).threshold)).toEqual([
      80, 100,
    ]);
  }, 30_000);

  it("новый месяц — счётчик с нуля: в ноябре 80 % снова одно уведомление", async () => {
    const { b, s } = fresh();
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    await b.spend(s, "2026-10-05", 16_000);
    await b.thresholds.recheckLimits(s);
    clock.set("2026-11-03T09:00:00Z");
    expect(await b.thresholds.recheckLimits(s)).toBe(0);
    await b.spend(s, "2026-11-02", 17_000);
    expect(await b.thresholds.recheckLimits(s)).toBe(1);
    expect(limitNotices(b)).toHaveLength(2);
  }, 30_000);

  it("импорт перепрыгнул 80 % сразу до 112 % — одно уведомление «100 %», а не два", async () => {
    const { b, s } = fresh();
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    await b.spend(s, "2026-10-05", 22_400);
    expect(await b.thresholds.recheckLimits(s)).toBe(1);
    expect(limitNotices(b)).toHaveLength(1);
    expect(limitNotices(b)[0]?.params).toMatchObject({ threshold: 100, percent: 112 });
    expect(await b.thresholds.recheckLimits(s)).toBe(0);
  }, 30_000);

  it("порог 80 % выключен человеком — шлётся только 100 %", async () => {
    const { b, s } = fresh();
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000), notify80: false }, "web");
    await b.spend(s, "2026-10-05", 16_000);
    expect(await b.thresholds.recheckLimits(s)).toBe(0);
    await b.spend(s, "2026-10-06", 5_000);
    expect(await b.thresholds.recheckLimits(s)).toBe(1);
    expect(limitNotices(b)[0]?.params).toMatchObject({ threshold: 100 });
  }, 30_000);

  it("лимит заведён поверх уже сделанных трат — уведомление сразу, без новой операции", async () => {
    const { b, s } = fresh();
    await b.spend(s, "2026-10-05", 16_000);
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    expect(limitNotices(b)).toHaveLength(1);
  }, 30_000);

  it("траты прошлого месяца в лимит текущего не входят", async () => {
    const { b, s } = fresh();
    await b.spend(s, "2026-09-20", 30_000);
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    expect(await b.thresholds.recheckLimits(s)).toBe(0);
    const [limit] = (await b.overview.view(s)).limits;
    expect(limit?.percent).toBe(0);
    const september = (await b.overview.view(s, "2026-09")).limits[0];
    expect(september).toMatchObject({ percent: 150, spent: byn(30_000) });
  }, 30_000);
});

describe("BUD-02, EXPL-01: проценты с сохранённой трассой", () => {
  it("процент лимита несёт traceId: сохранённый расчёт — траты с операциями-основаниями, лимит и процент", async () => {
    const { b, s } = fresh();
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    await b.spend(s, "2026-10-05", 16_000);
    const first = (await b.overview.view(s)).limits[0];
    const again = (await b.overview.view(s)).limits[0];
    expect(again?.traceId).toBe(first?.traceId);
    const stored = await b.r.t.explain.get(s, first?.traceId ?? "");
    expect(stored.trace).toMatchObject({
      key: "budgets.limitPercent",
      value: 80,
      inputs: [
        { key: "transactions.categoryTotal", value: byn(16_000) },
        { key: "budgets.limit", value: byn(20_000) },
      ],
    });
  }, 30_000);
});

describe("BUD-01, BUD-06, P5: лимит — создать, править, «Отменить»", () => {
  it("создание возвращает undoToken; «Отменить» убирает лимит", async () => {
    const { b, s } = fresh();
    const { limit, undoToken } = await b.limits.set(
      s,
      { categoryKey: CAFE, limit: byn(20_000) },
      "web",
    );
    expect(limit).toMatchObject({ categoryKey: "system:cafes", limit: byn(20_000), percent: 0 });
    expect((await b.overview.view(s)).limits).toHaveLength(1);
    await b.r.t.actions.undo(s, undoToken);
    expect((await b.overview.view(s)).limits).toHaveLength(0);
  }, 30_000);

  it("повторный вызов для той же категории — правка, а не второй лимит; «Отменить» возвращает прежнюю сумму и флаги", async () => {
    const { b, s } = fresh();
    await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    const edited = await b.limits.set(
      s,
      { categoryKey: CAFE, limit: byn(30_000), notify80: false },
      "web",
    );
    expect(edited.limit).toMatchObject({ limit: byn(30_000), notify80: false, notify100: true });
    expect((await b.overview.view(s)).limits).toHaveLength(1);
    await b.r.t.actions.undo(s, edited.undoToken);
    expect((await b.overview.view(s)).limits[0]).toMatchObject({
      limit: byn(20_000),
      notify80: true,
    });
  }, 30_000);

  it("лимит на доходную категорию, чужую «custom» и не в BYN отвергается", async () => {
    const { b, s } = fresh();
    const code = async (run: () => Promise<unknown>) =>
      run().then(
        () => "ok",
        (error: unknown) => (error instanceof AppError ? error.code : "other"),
      );
    expect(
      await code(() =>
        b.limits.set(
          s,
          { categoryKey: CategoryKey.parse("system:salary"), limit: byn(100) },
          "web",
        ),
      ),
    ).toBe("VALIDATION");
    expect(
      await code(() =>
        b.limits.set(
          s,
          {
            categoryKey: CategoryKey.parse("custom:0197f2c0-0000-7000-8000-000000000001"),
            limit: byn(100),
          },
          "web",
        ),
      ),
    ).toBe("VALIDATION");
    expect(
      await code(() => b.limits.set(s, { categoryKey: CAFE, limit: Money.of(100, "USD") }, "web")),
    ).toBe("VALIDATION");
    expect(await code(() => b.limits.set(s, { categoryKey: CAFE, limit: byn(0) }, "web"))).toBe(
      "VALIDATION",
    );
  }, 30_000);

  it("удаление — только решением: до «Да» лимит на месте, «Нет» ничего не меняет, «Да» убирает лимит и его уведомления", async () => {
    const { b, s } = fresh();
    const { limit } = await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    const decisionId = await b.limits.requestDelete(s, limit.id);
    expect((await b.overview.view(s)).limits).toHaveLength(1);
    await b.r.t.actions.answer(s, decisionId, "no", "web");
    expect((await b.overview.view(s)).limits).toHaveLength(1);
    const again = await b.limits.requestDelete(s, limit.id);
    await b.r.t.actions.answer(s, again, "yes", "web");
    expect((await b.overview.view(s)).limits).toHaveLength(0);
  }, 30_000);

  it("чужое домохозяйство не видит и не удаляет лимит: NOT_FOUND", async () => {
    const { b, s } = fresh();
    const { limit } = await b.limits.set(s, { categoryKey: CAFE, limit: byn(20_000) }, "web");
    const other = newScope(db);
    await expect(b.limits.requestDelete(other, limit.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await b.overview.view(other)).limits).toEqual([]);
  }, 30_000);
});

describe("BUD-04, BUD-05: копилка и рекомендуемый взнос", () => {
  const vacation = {
    name: "Отпуск",
    kind: "piggy",
    target: byn(300_000),
    deadline: "2027-06-01",
  } as const;

  it("цель 3 000 к 01.06.2027: 7 месяцев, взнос 429 BYN (вверх до рубля), правило — в трассе", async () => {
    const { b, s } = fresh();
    const { goal } = await b.goals.create(s, vacation as never, "web");
    expect(goal).toMatchObject({
      kind: "piggy",
      saved: byn(0),
      percent: 0,
      monthsLeft: 7,
      contribution: byn(42_900),
      fitsFreeBalance: null,
    });
    const stored = await b.r.t.explain.get(s, goal.contributionTraceId ?? "");
    expect(stored.trace.note).toBe("÷ 7 мес.; rounding=ceil-ruble step=100");
  }, 30_000);

  it("взнос увеличивает накопленное и сокращает рекомендуемый; «Отменить» возвращает как было", async () => {
    const { b, s } = fresh();
    const { goal } = await b.goals.create(s, vacation as never, "web");
    const done = await b.goals.contribute(s, { goalId: goal.id, amount: byn(60_000) }, "web");
    expect(done.goal).toMatchObject({ saved: byn(60_000), percent: 20, contribution: byn(34_300) });
    expect(done.goal.contributions).toEqual([
      { id: expect.any(String), amount: byn(60_000), madeOn: TODAY },
    ]);
    await b.r.t.actions.undo(s, done.undoToken);
    const after = (await b.overview.view(s)).goals[0];
    expect(after).toMatchObject({ saved: byn(0), contributions: [] });
  }, 30_000);

  it("взнос в цель по счёту — VALIDATION { reason: linked-goal }", async () => {
    const { b, s } = fresh();
    const { account } = await b.r.t.accounts.create(
      s,
      {
        kind: "savings",
        name: "Накопительный",
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalance: byn(100_000),
      },
      "web",
    );
    const { goal } = await b.goals.create(
      s,
      {
        name: "Резерв",
        kind: "account",
        target: byn(300_000),
        deadline: "2027-06-01",
        accountId: account.id,
      } as never,
      "web",
    );
    await expect(
      b.goals.contribute(s, { goalId: goal.id, amount: byn(1_000) }, "web"),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      params: { reason: "linked-goal" },
    });
  }, 30_000);

  it("правка названия, суммы и срока — с «Отменить»; срок в прошлом и сумма 0 отвергаются", async () => {
    const { b, s } = fresh();
    const { goal } = await b.goals.create(s, vacation as never, "web");
    const edited = await b.goals.update(
      s,
      { id: goal.id, name: "Отпуск на море", target: byn(400_000) },
      "web",
    );
    expect(edited.goal).toMatchObject({ name: "Отпуск на море", target: byn(400_000) });
    await b.r.t.actions.undo(s, edited.undoToken);
    expect((await b.overview.view(s)).goals[0]).toMatchObject({
      name: "Отпуск",
      target: byn(300_000),
    });
    await expect(
      b.goals.update(s, { id: goal.id, deadline: "2026-10-01" as never }, "web"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(b.goals.update(s, { id: goal.id, target: byn(0) }, "web")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  }, 30_000);

  it("«Отменить» создания цели, в которую уже внесли взносы, — CONFLICT: взносы не пропадают молча", async () => {
    const { b, s } = fresh();
    const created = await b.goals.create(s, vacation as never, "web");
    await b.goals.contribute(s, { goalId: created.goal.id, amount: byn(1_000) }, "web");
    await expect(b.r.t.actions.undo(s, created.undoToken)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await b.overview.view(s)).goals).toHaveLength(1);
  }, 30_000);

  it("удаление цели — решением «Да»: цель и её взносы уходят", async () => {
    const { b, s } = fresh();
    const { goal } = await b.goals.create(s, vacation as never, "web");
    await b.goals.contribute(s, { goalId: goal.id, amount: byn(1_000) }, "web");
    const decisionId = await b.goals.requestDelete(s, goal.id);
    expect((await b.overview.view(s)).goals).toHaveLength(1);
    await b.r.t.actions.answer(s, decisionId, "yes", "web");
    expect((await b.overview.view(s)).goals).toEqual([]);
  }, 30_000);
});

describe("BUD-05: «укладывается ли в свободный остаток»", () => {
  it("на истории за 6 месяцев: 429 BYN в месяц укладывается в свободный остаток, 50 000 — нет; нет остатка — null", async () => {
    const { b, s } = fresh();
    const small = await b.goals.create(
      s,
      { name: "Отпуск", kind: "piggy", target: byn(300_000), deadline: "2027-06-01" } as never,
      "web",
    );
    expect(small.goal.fitsFreeBalance).toBeNull();
    const history = b.r.generateHistory({ seed: 7, today: TODAY });
    await b.r.seed(s, history.operations);
    await b.r.recompute(s);
    const huge = await b.goals.create(
      s,
      { name: "Квартира", kind: "piggy", target: byn(35_000_000), deadline: "2027-06-01" } as never,
      "web",
    );
    const view = await b.overview.view(s);
    expect(view.freeBalance?.minor).toBeGreaterThan(42_900);
    expect(view.goals.find((g) => g.id === small.goal.id)?.fitsFreeBalance).toBe(true);
    expect(view.goals.find((g) => g.id === huge.goal.id)?.fitsFreeBalance).toBe(false);
    expect(view.freeBalanceTraceId).not.toBeNull();
  }, 60_000);
});

describe("BUD-04 (КП): цель по счёту — прогресс равен остатку накопительного счёта", () => {
  it("цель по счёту — только накопительный счёт или вклад; карта и чужой счёт отвергаются", async () => {
    const { b, s } = fresh();
    const { account: card } = await b.r.t.accounts.create(
      s,
      {
        kind: "card",
        name: "Карта",
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalance: byn(0),
      },
      "web",
    );
    const goal = {
      name: "Резерв",
      kind: "account",
      target: byn(300_000),
      deadline: "2027-06-01",
    } as const;
    await expect(
      b.goals.create(s, { ...goal, accountId: card.id } as never, "web"),
    ).rejects.toMatchObject({ code: "VALIDATION", params: { reason: "account-kind" } });
    await expect(
      b.goals.create(
        s,
        { ...goal, accountId: "0197f2c0-0000-7000-8000-000000000001" } as never,
        "web",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.goals.create(s, { ...goal } as never, "web")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  }, 30_000);

  it("остаток счёта изменился (импорт выписки) — прогресс и пороги 50/100 % обновляются сами", async () => {
    const { b, s } = fresh();
    const { account } = await b.r.t.accounts.create(
      s,
      {
        kind: "deposit",
        name: "Вклад",
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalance: byn(100_000),
      },
      "web",
    );
    const { goal } = await b.goals.create(
      s,
      {
        name: "Резерв",
        kind: "account",
        target: byn(300_000),
        deadline: "2027-06-01",
        accountId: account.id,
      } as never,
      "web",
    );
    expect(goal).toMatchObject({ saved: byn(100_000), percent: 33, contribution: byn(28_600) });
    const goalNotices = () => b.notices.filter((n) => n.kind === "goal");
    expect(goalNotices()).toHaveLength(0);
    await b.r.t.accounts.setInitialBalance(
      s,
      { id: account.id, initialBalance: byn(160_000) } as never,
      "web",
    );
    expect(await b.thresholds.recheckGoals(s)).toBe(1);
    expect((await b.overview.view(s)).goals[0]).toMatchObject({ saved: byn(160_000), percent: 53 });
    expect(goalNotices()[0]?.params).toMatchObject({ reason: "half", percent: 53 });
    await b.r.t.accounts.setInitialBalance(
      s,
      { id: account.id, initialBalance: byn(310_000) } as never,
      "web",
    );
    expect(await b.thresholds.recheckGoals(s)).toBe(1);
    expect(await b.thresholds.recheckGoals(s)).toBe(0);
    expect(goalNotices().map((n) => (n.params as { reason: string }).reason)).toEqual([
      "half",
      "done",
    ]);
  }, 30_000);

  it("счёт цели удалён — прогресса нет («нет данных»), а не 0 %", async () => {
    const { b, s } = fresh();
    const { account } = await b.r.t.accounts.create(
      s,
      {
        kind: "savings",
        name: "Копилка",
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalance: null,
      },
      "web",
    );
    await b.goals.create(
      s,
      {
        name: "Резерв",
        kind: "account",
        target: byn(300_000),
        deadline: "2027-06-01",
        accountId: account.id,
      } as never,
      "web",
    );
    const decisionId = await b.r.t.accounts.requestDelete(s, account.id);
    await b.r.t.actions.answer(s, decisionId, "yes", "web");
    expect((await b.overview.view(s)).goals[0]).toMatchObject({
      accountMissing: true,
      saved: null,
      percent: null,
      contribution: null,
    });
  }, 30_000);
});

describe("BUD-07: уведомления о цели", () => {
  const goal = {
    name: "Отпуск",
    kind: "piggy",
    target: byn(100_000),
    deadline: "2026-12-01",
  } as const;

  it("копилка: 50 % — одно уведомление, 100 % — второе, повторы не шлют", async () => {
    const { b, s } = fresh();
    const created = await b.goals.create(s, goal as never, "web");
    await b.goals.contribute(s, { goalId: created.goal.id, amount: byn(50_000) }, "web");
    await b.goals.contribute(s, { goalId: created.goal.id, amount: byn(1_000) }, "web");
    await b.goals.contribute(s, { goalId: created.goal.id, amount: byn(49_000) }, "web");
    await b.thresholds.recheckGoals(s);
    expect(
      b.notices
        .filter((n) => n.kind === "goal")
        .map((n) => (n.params as { reason: string }).reason),
    ).toEqual(["half", "done"]);
  }, 30_000);

  it("«отстаёт от графика»: накоплено < плановое − 10 % — одно уведомление в месяц; в следующем — снова", async () => {
    const { b, s } = fresh("2026-06-01");
    await b.goals.create(s, goal as never, "web");
    clock.set("2026-10-28T09:00:00Z");
    const [row] = (await b.overview.view(s)).goals;
    expect(row).toMatchObject({ behind: true });
    const id = row?.id ?? "";
    expect(await b.thresholds.checkGoal(s, id)).toBe(1);
    expect(await b.thresholds.checkGoal(s, id)).toBe(0);
    clock.set("2026-11-05T09:00:00Z");
    expect(await b.thresholds.checkGoal(s, id)).toBe(1);
    expect(
      b.notices.filter((n) => n.kind === "goal").map((n) => n.key.split(":").slice(1).join(":")),
    ).toEqual(["behind:2026-10", "behind:2026-11"]);
  }, 30_000);

  it("накоплено в графике — не отстаёт, уведомления нет", async () => {
    const { b, s } = fresh("2026-06-01");
    const created = await b.goals.create(s, goal as never, "web");
    clock.set("2026-10-28T09:00:00Z");
    await b.goals.contribute(s, { goalId: created.goal.id, amount: byn(80_000) }, "web");
    // 80 % при плане ~83 %: в допуске 10 % — не «отстаёт»; «половина» уже ушла при взносе.
    expect(await b.thresholds.checkGoal(s, created.goal.id)).toBe(0);
    expect(b.notices.some((n) => (n.params as { reason?: string }).reason === "behind")).toBe(
      false,
    );
  }, 30_000);
});
