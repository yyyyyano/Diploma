// REC-01…05, PROF-03, P5 на Postgres: поиск регулярных по синтетической истории за 6 месяцев (@kosht/synth), решения
// человека с «Отменить» (настоящий журнал actions), «возможно прекращён» и одно уведомление при ходе времени
// (FakeClock), факты-предположения профиля, признак «регулярный» в «Операциях», изоляция домохозяйств.
import { RecurringId } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crossTenant } from "../../../platform/db/cross-tenant.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { findActiveDetected } from "../infrastructure/db/recurring.repo.ts";
import { clock, recurringWithJournal } from "../../../main/__fixtures__/recurring-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const TODAY = "2026-10-28";

/** Сценарий с историей за 6 месяцев (зерно 7) и уже выполненным поиском. */
async function withHistory() {
  clock.set(`${TODAY}T09:00:00Z`);
  const r = recurringWithJournal(db);
  const s = r.s();
  const history = r.generateHistory({ seed: 7, today: TODAY });
  await r.seed(s, history.operations);
  await r.recompute(s);
  const list = await r.read.list(s, { onDate: LocalDate.parse(TODAY) });
  const byName = (part: string, day?: number) =>
    list.find((e) => e.name.includes(part) && (day === undefined || e.anchorDay === day));
  return { r, s, history, list, byName };
}

describe("REC-01: поиск по истории за 6 месяцев", () => {
  it("находит десять регулярных платежей: разделы, дни и состояния как в эталоне, шума нет", async () => {
    const { list, history } = await withHistory();
    const found = list.map((e) => `${e.section}|${e.state}|${e.anchorDay}`).toSorted();
    const expected = history.expected.map((e) => `${e.section}|${e.state}|${e.day}`).toSorted();
    expect(found).toEqual(expected);
    expect(list.some((e) => e.name.includes("Зерно") || e.name.includes("Евроопт"))).toBe(false);
  }, 60_000);

  it("аванс (10-е) и зарплата (25-е) одного нанимателя — два платежа с разной суммой", async () => {
    const { list } = await withHistory();
    const incomes = list.filter((e) => e.section === "income");
    expect(incomes.map((e) => [e.anchorDay, e.average.value.minor])).toEqual(
      expect.arrayContaining([
        [10, 96_000],
        [25, 144_000],
      ]),
    );
  }, 60_000);

  it("ЖКХ с разной суммой — среднее с основаниями-операциями в refs и разброс «от … до»", async () => {
    const { byName } = await withHistory();
    const utilities = byName("ЖКУ");
    expect(utilities?.amountRange).not.toBeNull();
    const refs: string[] = [];
    const collect = (node: { refs: readonly { id: string }[]; inputs: readonly never[] }) => {
      refs.push(...node.refs.map((r) => r.id));
      for (const input of node.inputs) collect(input);
    };
    collect(utilities?.average.trace as never);
    expect(refs.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it("следующая дата и период: кредит 23-го — ежемесячный, следующий 23.11", async () => {
    const { byName } = await withHistory();
    expect(byName("кредит")).toMatchObject({
      period: "month",
      nextExpectedOn: "2026-11-23",
      section: "mandatory",
      state: "active",
    });
  }, 60_000);

  it("найденное в «Других» — предположение, в подписках и обязательных — сразу действует", async () => {
    const { byName } = await withHistory();
    expect(byName("РобоКлуб")).toMatchObject({
      section: "other",
      state: "suggested",
      counted: false,
    });
    expect(byName("Яндекс")).toMatchObject({
      section: "subscriptions",
      state: "active",
      counted: true,
    });
  }, 60_000);

  it("повторный пересчёт ничего не меняет: ни записей, ни событий", async () => {
    const { r, s } = await withHistory();
    const before = r.recurringEvents().length;
    expect(await r.recompute(s)).toEqual([]);
    expect(r.recurringEvents()).toHaveLength(before);
  }, 60_000);

  it("первый поиск — одно событие recurring.changed пачкой id, а не событие на платёж", async () => {
    const { r, history } = await withHistory();
    expect(r.recurringEvents()).toHaveLength(1);
    expect(r.recurringEvents()[0]?.ids).toHaveLength(history.expected.length);
  }, 60_000);
});

describe("REC-04: итоги разделов и факты профиля", () => {
  it("итог доходов в месяц — 2 400,00; подписки — 28,98 в месяц и 347,76 в год; «Другие» итога не имеют", async () => {
    const { r, s } = await withHistory();
    const page = await r.read.page(s, {});
    const total = (section: string) => page.totals.find((t) => t.section === section);
    expect(total("income")?.monthly).toEqual({ minor: 240_000, currency: "BYN" });
    expect(total("subscriptions")).toMatchObject({
      monthly: { minor: 2_898 },
      yearly: { minor: 34_776 },
    });
    expect(total("other")).toMatchObject({ monthly: null, yearly: null });
  }, 60_000);

  it("PROF-03: «регулярный доход» и «обязательные платежи» — предположения профиля с суммами в месяц", async () => {
    const { r, s } = await withHistory();
    const found = await r.facts.getFacts(
      s,
      ["income.regular", "obligations.regular"],
      LocalDate.parse(TODAY),
    );
    expect(found.map((f) => [f.value.key, f.status, f.source])).toEqual(
      expect.arrayContaining([
        ["income.regular", "assumed", "system"],
        ["obligations.regular", "assumed", "system"],
      ]),
    );
    const income = found.find((f) => f.value.key === "income.regular");
    expect(income?.value).toMatchObject({ amount: { minor: 240_000 } });
  }, 60_000);

  it("подтверждённое человеком не перетирается новым выводом", async () => {
    const { r, s } = await withHistory();
    const income = (await r.facts.getFacts(s, ["income.regular"], LocalDate.parse(TODAY)))[0];
    await r.facts.confirm(s, income?.id ?? "", "web");
    await r.decisions.create(
      s,
      {
        name: "Подработка",
        section: "income",
        amount: { minor: 50_000, currency: "BYN" },
        period: "month",
        anchorDay: 3,
      },
      "web",
    );
    const after = (await r.facts.getFacts(s, ["income.regular"], LocalDate.parse(TODAY)))[0];
    expect(after).toMatchObject({ status: "confirmed", value: { amount: { minor: 240_000 } } });
  }, 60_000);
});

describe("REC-02: решения человека с «Отменить»", () => {
  it("«Да, регулярный» переводит предположение в «действует», «Отменить» возвращает предположение", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("РобоКлуб")?.id ?? "";
    const { item, undoToken } = await r.decisions.confirm(s, id, "web");
    expect(item.state).toBe("active");
    await r.t.actions.undo(s, undoToken);
    expect(
      (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).find((e) => e.id === id)?.state,
    ).toBe("suggested");
  }, 60_000);

  it("«Это не регулярный» исключает платёж: он пропадает из списка и больше не находится поиском", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("РобоКлуб")?.id ?? "";
    await r.decisions.exclude(s, id, "web");
    await r.recompute(s);
    const list = await r.read.list(s, { onDate: LocalDate.parse(TODAY) });
    expect(list.some((e) => e.name.includes("РобоКлуб"))).toBe(false);
    expect(await r.read.markers(s, [])).toEqual([]);
  }, 60_000);

  it("«Отменить» исключения возвращает платёж; повторная отмена — «уже отменено»", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("РобоКлуб")?.id ?? "";
    const { undoToken } = await r.decisions.exclude(s, id, "web");
    expect(await r.t.actions.undo(s, undoToken)).toBe("undone");
    expect(await r.t.actions.undo(s, undoToken)).toBe("already-undone");
    expect(
      (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).some((e) => e.id === id),
    ).toBe(true);
  }, 60_000);

  it("«Да, регулярный» на уже действующий платёж — CONFLICT (кто-то успел раньше)", async () => {
    const { r, s, byName } = await withHistory();
    await expect(r.decisions.confirm(s, byName("кредит")?.id ?? "", "web")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  }, 60_000);

  it("«Исправить сумму и дату»: названная сумма перекрывает среднюю и не перетирается следующим поиском", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("Беларусбанк")?.id ?? "";
    await r.decisions.edit(
      s,
      { id: RecurringId.parse(id), amount: { minor: 45_000, currency: "BYN" }, anchorDay: 20 },
      "web",
    );
    // Новая операция заставляет поиск пройти заново.
    await r.seed(s, [
      {
        date: "2026-10-27",
        merchant: "Беларусбанк кредит",
        type: "expense",
        amountMinor: 41_000,
        category: "loans",
      },
    ]);
    await r.recompute(s);
    const item = (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).find(
      (e) => e.id === id,
    );
    expect(item).toMatchObject({ amountIsManual: true, anchorDay: 20 });
    expect(item?.average.value.minor).toBe(45_000);
  }, 60_000);

  it("тип, поправленный человеком («Другие» → «Обязательные»), следующий поиск не перетирает", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("РобоКлуб")?.id ?? "";
    await r.decisions.edit(s, { id: RecurringId.parse(id), section: "mandatory" }, "web");
    await r.seed(s, [
      {
        date: "2026-10-27",
        merchant: "Центр РобоКлуб кружок",
        type: "expense",
        amountMinor: 6_000,
        category: "kids",
      },
    ]);
    await r.recompute(s);
    expect(
      (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).find((e) => e.id === id)?.section,
    ).toBe("mandatory");
  }, 60_000);

  it("«Добавить вручную»: платёж действует сразу, попадает в ближайшие; «Отменить» его убирает", async () => {
    const { r, s } = await withHistory();
    const { item, undoToken } = await r.decisions.create(
      s,
      {
        name: "Аренда гаража",
        section: "mandatory",
        amount: { minor: 12_000, currency: "BYN" },
        period: "month",
        anchorDay: 30,
      },
      "web",
    );
    expect(item).toMatchObject({ state: "active", source: "manual", nextExpectedOn: "2026-10-30" });
    const upcoming = await r.read.upcoming(s, {
      from: LocalDate.parse("2026-10-29"),
      to: LocalDate.parse("2026-11-02"),
    });
    expect(upcoming.map((p) => p.name)).toContain("Аренда гаража");
    await r.t.actions.undo(s, undoToken);
    expect(
      (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).some((e) => e.id === item.id),
    ).toBe(false);
  }, 60_000);

  it("сумма не в BYN или не больше нуля — VALIDATION", async () => {
    const { r, s } = await withHistory();
    await expect(
      r.decisions.create(
        s,
        { name: "Х", section: "other", amount: { minor: 0, currency: "BYN" }, period: "month" },
        "web",
      ),
    ).rejects.toBeInstanceOf(AppError);
  }, 60_000);

  it("«Вернуть в регулярные» оживляет прекращённый платёж", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("Атлетик")?.id ?? "";
    await r.decisions.end(s, id, "web");
    expect(
      (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).find((e) => e.id === id)?.state,
    ).toBe("ended");
    await r.decisions.resume(s, id, "web");
    expect(
      (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).find((e) => e.id === id)?.state,
    ).toBe("active");
  }, 60_000);
});

describe("REC-05: «возможно прекращён» (у подтверждённых человеком и найденных в обязательных)", () => {
  it("абонемент, не пришедший 10 дней после ожидаемой даты 12.10, — «возможно прекращён» и одно уведомление", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("Атлетик")?.id ?? "";
    await r.decisions.confirm(s, id, "web");
    expect(await r.checkMissed(s, id)).toBe(true);
    expect(r.notices).toEqual([
      {
        kind: "recurring-missed",
        key: `${id}:2026-10-12`,
        objectRef: { entity: "recurring", id },
        params: expect.anything(),
      },
    ]);
    const item = (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).find(
      (e) => e.id === id,
    );
    expect(item).toMatchObject({ state: "maybe-ended", overdueDays: 16, counted: false });
  }, 60_000);

  it("до 10 дней — рано: 21.10 платёж ещё «действует» и уведомления нет", async () => {
    const { r, s, byName } = await withHistory();
    clock.set("2026-10-21T09:00:00Z");
    const id = byName("Атлетик")?.id ?? "";
    await r.decisions.confirm(s, id, "web");
    expect(await r.checkMissed(s, id)).toBe(false);
    expect(r.notices).toEqual([]);
  }, 60_000);

  it("время идёт и без новых операций: на 10-й день (22.10) обход помечает платёж", async () => {
    const { r, s, byName } = await withHistory();
    clock.set("2026-10-22T09:00:00Z");
    const id = byName("Атлетик")?.id ?? "";
    await r.decisions.confirm(s, id, "web");
    expect(await r.checkMissed(s, id)).toBe(true);
  }, 60_000);

  it("повтор обхода не дублирует уведомление (ключ — платёж и ожидаемая дата)", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("Атлетик")?.id ?? "";
    await r.decisions.confirm(s, id, "web");
    await r.checkMissed(s, id);
    clock.set("2026-10-29T09:00:00Z");
    expect(await r.checkMissed(s, id)).toBe(false);
    expect(r.notices).toHaveLength(1);
  }, 60_000);

  it("«Ещё придёт»: на эту ожидаемую дату «возможно прекращён» больше не ставится", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("Атлетик")?.id ?? "";
    await r.decisions.confirm(s, id, "web");
    await r.checkMissed(s, id);
    await r.decisions.stillComing(s, id, "web");
    expect(await r.checkMissed(s, id)).toBe(false);
  }, 60_000);

  it("выписка с опозданием принесла платёж за 14.10 — «возможно прекращён» снова «действует»", async () => {
    const { r, s, byName } = await withHistory();
    const id = byName("Атлетик")?.id ?? "";
    await r.decisions.confirm(s, id, "web");
    await r.checkMissed(s, id);
    await r.seed(s, [
      {
        date: "2026-10-14",
        merchant: "Клуб Атлетик абонемент",
        type: "expense",
        amountMinor: 5_500,
        category: "leisure",
      },
    ]);
    await r.recompute(s);
    const item = (await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).find(
      (e) => e.id === id,
    );
    expect(item).toMatchObject({ state: "active" });
  }, 60_000);

  it("сквозной поиск обхода находит владельцев действующих найденных платежей — каждого по домохозяйству", async () => {
    const { r, s } = await withHistory();
    const other = r.s();
    await r.read.list(other, { onDate: LocalDate.parse(TODAY) });
    const rows = await crossTenant(db.pool, "recurring.check-missed-sweep", findActiveDetected);
    const households = new Set(rows.map((row) => row.householdId));
    expect(households).toContain(s.scope.householdId);
    expect(households).not.toContain(other.scope.householdId);
  }, 60_000);
});

describe("REC-03: ближайшие платежи", () => {
  it("с 29.10 по 3.11: кредит на 23.11 вне окна, а 1.11 — Яндекс Плюс, 2.11 — мобильная связь", async () => {
    const { r, s } = await withHistory();
    const found = await r.read.upcoming(s, {
      from: LocalDate.parse("2026-10-29"),
      to: LocalDate.parse("2026-11-03"),
    });
    expect(found.map((p) => [p.on, p.amount.value.minor])).toEqual([
      ["2026-11-01", 1_599],
      ["2026-11-02", 1_000],
    ]);
  }, 60_000);
});

describe("EXPL-01: «Откуда эта цифра?»", () => {
  it("расчёт средней суммы сохраняется с операциями-основаниями", async () => {
    const { r, s, byName } = await withHistory();
    const traceId = await r.read.explain(s, byName("ЖКУ")?.id ?? "");
    const saved = await r.t.explain.get(s, traceId);
    expect(saved.trace).toMatchObject({ key: "recurring.averageAmount", op: "avg" });
  }, 60_000);
});

describe("REC-02: признак «регулярный» в «Операциях»", () => {
  it("помечены операции регулярного платежа; разовые покупки и исключённые — нет", async () => {
    const { r, s, byName } = await withHistory();
    const credit = byName("кредит");
    const rows = await r.t.transactionsFacade.recurringHistory(s, {
      from: "2026-01-01",
      to: TODAY,
    });
    const creditOps = rows.filter((row) => row.merchantKey.includes("КРЕДИТ")).map((row) => row.id);
    const shop = rows
      .filter((row) => row.merchantKey.includes("ЕВРООПТ"))
      .slice(0, 3)
      .map((row) => row.id);
    expect(credit).toBeDefined();
    expect(creditOps).toHaveLength(7);
    expect(shop.length).toBeGreaterThan(0);
    const marked = await r.read.markers(s, [...creditOps, ...shop]);
    expect(marked.toSorted()).toEqual(creditOps.toSorted());
    await r.decisions.exclude(s, credit?.id ?? "", "web");
    expect(await r.read.markers(s, creditOps)).toEqual([]);
  }, 60_000);
});

describe("ROLE-01: изоляция", () => {
  it("чужой платёж — NOT_FOUND для решения и «Откуда цифра», в списке чужого нет", async () => {
    const { r, byName } = await withHistory();
    const id = byName("кредит")?.id ?? "";
    const stranger = r.s();
    await expect(r.decisions.exclude(stranger, id, "web")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(r.read.explain(stranger, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await r.read.list(stranger, { onDate: LocalDate.parse(TODAY) })).toEqual([]);
  }, 60_000);
});

describe("REC-01: история, загруженная до модуля", () => {
  it("операции лежат без поиска — первое чтение платежей находит их без новой операции", async () => {
    clock.set(`${TODAY}T09:00:00Z`);
    const r = recurringWithJournal(db);
    const s = r.s();
    await r.seed(s, r.generateHistory({ seed: 7, today: TODAY }).operations);
    // Операции записаны, поиск не запускался (событие transactions.changed «потеряно» — история старше модуля).
    const list = await r.read.list(s, { onDate: LocalDate.parse(TODAY) });
    expect(list).toHaveLength(10);
  }, 60_000);

  it("пересчёт — один на домохозяйство: пустое чтение больше не ищет заново", async () => {
    clock.set(`${TODAY}T09:00:00Z`);
    const r = recurringWithJournal(db);
    const s = r.s();
    const spy = vi.spyOn(r.t.transactionsFacade, "recurringHistory");
    expect(await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).toEqual([]);
    expect(await r.read.list(s, { onDate: LocalDate.parse(TODAY) })).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 60_000);
});
