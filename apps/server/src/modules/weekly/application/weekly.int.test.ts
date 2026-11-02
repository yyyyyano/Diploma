// WEEK-01, WEEK-02, WEEK-03, NFR-22, P1, EXPL-02 на Postgres с настоящими соседями (transactions, budgets, calendar, categories,
// explain): пример SPEC (312 BYN — на 18 % больше обычного, лимит на кафе 85 %, платежи недели 74 BYN), текст модели под стражем чисел и
// шаблон, когда модели нет, срок по часам пользователя, выключенный компьютер, выключенная сводка, изоляция. Модель — управляемая заглушка.
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clock, weeklyWithJournal } from "../../../main/__fixtures__/weekly-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const byn = (minor: number) => ({ minor, currency: "BYN" }) as const;
/** Минск — UTC+3: понедельник 09:00 по Минску = 06:00Z. 2026-11-02 — понедельник. */
const at = (day: string, minsk: string) => {
  const [h = "0", m = "0"] = minsk.split(":");
  clock.set(`${day}T${String(Number(h) - 3).padStart(2, "0")}:${m}:00Z`);
};

const op = (date: string, merchant: string, amountMinor: number, category: string) => ({
  date,
  merchant,
  type: "expense" as const,
  amountMinor,
  category,
});

/** Прошлые восемь недель (31.08–25.10): по одной покупке 264,41 в понедельник каждой недели — всего 2 115,28, в среднем 264,41. */
const PREVIOUS = [
  "2026-08-31",
  "2026-09-07",
  "2026-09-14",
  "2026-09-21",
  "2026-09-28",
  "2026-10-05",
  "2026-10-12",
  "2026-10-19",
].map((date, index) => op(date, `Магазин ${String(index + 1)}`, 26_441, "groceries"));

/** Прошлая неделя 26.10–01.11: такси 90, продукты 52, кафе 170 — всего 312,00 (на 18 % больше обычных 264,41). */
const LAST_WEEK = [
  op("2026-10-28", "Такси Город", 9000, "taxi"),
  op("2026-10-29", "Евроопт", 5200, "groceries"),
  op("2026-11-01", "Кофейня «Зерно»", 17_000, "cafes"),
];

async function setup(options: { history?: boolean } = {}) {
  at("2026-11-02", "09:00");
  const w = weeklyWithJournal(db);
  const s = w.s();
  if (options.history !== false) await w.r.seed(s, [...PREVIOUS, ...LAST_WEEK]);
  return { w, s };
}

/** Модель отвечает текстом по готовым числам документа. */
const modelSays = (text: string) => () => ({ text });

describe("WEEK-02: числа недели — пример SPEC", () => {
  it("траты 312,00, обычные 264,41, на 18 % больше; категории по убыванию; платежи недели 74,00 из событий календаря; лимит кафе 85 %", async () => {
    const { w, s } = await setup();
    await w.a.limits.set(s, { categoryKey: "system:cafes", limit: byn(20_000) } as never, "web");
    await w.a.c.events.create(
      s,
      {
        title: "Интернет",
        on: LocalDate.parse("2026-11-03"),
        amount: byn(3000),
        type: "own",
      } as never,
      "web",
    );
    await w.a.c.events.create(
      s,
      {
        title: "Рассрочка",
        on: LocalDate.parse("2026-11-05"),
        amount: byn(4400),
        type: "own",
      } as never,
      "web",
    );

    expect(await w.run(s)).toBe("created");
    const summary = await w.read.latest(s);
    expect(summary).toMatchObject({ weekStart: "2026-10-26", weekEnd: "2026-11-01", weeksUsed: 8 });
    expect(summary?.spent.amount).toEqual(byn(31_200));
    expect(summary?.average?.amount).toEqual(byn(26_441));
    expect(summary?.deviation?.percent).toBe(18);
    expect(summary?.categories.map((c) => [c.name, c.amount.amount.minor])).toEqual([
      ["Кафе, рестораны и доставка", 17_000],
      ["Такси", 9000],
      ["Продукты", 5200],
    ]);
    expect(summary?.limits).toMatchObject([{ name: "Кафе, рестораны и доставка", percent: 85 }]);
    expect(summary?.upcoming.payments?.amount).toEqual(byn(7400));
    expect(summary?.upcoming.items.map((i) => [i.title, i.on])).toEqual([
      ["Интернет", "2026-11-03"],
      ["Рассрочка", "2026-11-05"],
    ]);
  });

  it("у каждого числа traceId ведёт к сохранённому расчёту с тем же значением", async () => {
    const { w, s } = await setup();
    await w.run(s);
    const summary = await w.read.latest(s);
    const spent = await w.r.t.explain.get(s, summary?.spent.traceId as never);
    expect(spent.trace.value).toEqual(byn(31_200));
    const average = await w.r.t.explain.get(s, summary?.average?.traceId as never);
    expect(average.trace).toMatchObject({ key: "weekly.average", value: byn(26_441) });
    expect(average.trace.inputs.map((input) => input.key)).toEqual([
      "transactions.expense",
      "weekly.weeks",
    ]);
    const deviation = await w.r.t.explain.get(s, summary?.deviation?.traceId as never);
    expect(deviation.trace).toMatchObject({ key: "weekly.deviation", value: 18 });
    const top = await w.r.t.explain.get(s, summary?.categories[0]?.amount.traceId as never);
    expect(top.trace.value).toEqual(byn(17_000));
  });

  it("истории меньше восьми недель — среднее по тем, что есть; меньше одной — сравнения нет", async () => {
    at("2026-11-02", "09:00");
    const w = weeklyWithJournal(db);
    const s = w.s();
    // Первая операция — 12.10: до недели сводки полных недель 2 (12–18 и 19–25).
    await w.r.seed(s, [
      op("2026-10-12", "М1", 10_000, "groceries"),
      op("2026-10-20", "М2", 20_000, "groceries"),
      ...LAST_WEEK,
    ]);
    await w.run(s);
    const two = await w.read.latest(s);
    expect(two?.weeksUsed).toBe(2);
    expect(two?.average?.amount).toEqual(byn(15_000));

    const other = weeklyWithJournal(db);
    const s2 = other.s();
    await other.r.seed(s2, [op("2026-10-27", "М", 5000, "groceries")]);
    await other.run(s2);
    const none = await other.read.latest(s2);
    expect(none).toMatchObject({ weeksUsed: 0, average: null, deviation: null });
  });

  it("тратить нечего — сводка с нулём, без категорий и сравнения с нулевым средним", async () => {
    at("2026-11-02", "09:00");
    const w = weeklyWithJournal(db);
    const s = w.s();
    await w.r.seed(s, [op("2026-10-01", "М", 5000, "groceries")]);
    await w.run(s);
    const summary = await w.read.latest(s);
    expect(summary?.spent.amount).toEqual(byn(0));
    expect(summary?.categories).toEqual([]);
  });
});

describe("WEEK-02: текст — модель под стражем чисел или шаблон", () => {
  it("модель называет только числа документа — текст сохранён как её, source = model; модель получила числа готовыми строками", async () => {
    const { w, s } = await setup();
    w.answerWith(
      modelSays(
        "На прошлой неделе вы потратили 312,00 BYN — на 18 % больше обычного. Больше всего ушло на кафе.",
      ),
    );
    await w.run(s);
    const summary = await w.read.latest(s);
    expect(summary).toMatchObject({ textSource: "model" });
    expect(summary?.text).toContain("312,00");
    const [caller, request] = w.calls[0] ?? [];
    expect(caller).toMatchObject({ householdId: s.scope.householdId });
    expect(request).toMatchObject({ task: "weekly.summary", promptVersion: "weekly-summary-1" });
    const document = JSON.parse((request as { document: string }).document) as Record<
      string,
      unknown
    >;
    expect(document).toMatchObject({
      spent: expect.stringContaining("312,00"),
      changeVsUsualPercent: 18,
    });
  });

  it("выдуманное число в тексте модели — весь текст заменён шаблоном из тех же чисел", async () => {
    const { w, s } = await setup();
    w.answerWith(modelSays("На прошлой неделе вы потратили 999,00 BYN."));
    await w.run(s);
    const summary = await w.read.latest(s);
    expect(summary?.textSource).toBe("template");
    expect(summary?.text).toContain("потратили 312,00");
    expect(summary?.text).not.toContain("999");
  });

  it("модели нет (ошибка вызова) — итог всё равно выходит по шаблону, уведомление уходит", async () => {
    const { w, s } = await setup();
    await w.run(s);
    const summary = await w.read.latest(s);
    expect(summary?.textSource).toBe("template");
    expect(summary?.text).toBe(
      "На прошлой неделе вы потратили 312,00 BYN, на 18 % больше обычного. Больше всего — на Кафе, рестораны и доставка.",
    );
    expect(w.notices()).toHaveLength(1);
  });

  it("лимит и платежи в шаблоне, когда они есть", async () => {
    const { w, s } = await setup();
    await w.a.limits.set(s, { categoryKey: "system:cafes", limit: byn(20_000) } as never, "web");
    await w.a.c.events.create(
      s,
      {
        title: "Интернет",
        on: LocalDate.parse("2026-11-03"),
        amount: byn(3000),
        type: "own",
      } as never,
      "web",
    );
    await w.a.c.events.create(
      s,
      {
        title: "Рассрочка",
        on: LocalDate.parse("2026-11-05"),
        amount: byn(4400),
        type: "own",
      } as never,
      "web",
    );
    await w.run(s);
    expect((await w.read.latest(s))?.text).toBe(
      "На прошлой неделе вы потратили 312,00 BYN, на 18 % больше обычного. Больше всего — на Кафе, рестораны и доставка. Лимит «Кафе, рестораны и доставка» израсходован на 85 %. В ближайшие 7 дней спишутся Интернет и Рассрочка — 74,00 BYN.",
    );
  });
});

describe("WEEK-01, WEEK-03, NFR-22: когда итог выходит", () => {
  it("в понедельник в 09:00 — итог за прошлую неделю; повторный запуск того же момента ничего не добавляет, уведомление одно", async () => {
    const { w, s } = await setup();
    expect(await w.run(s)).toBe("created");
    expect(await w.run(s)).toBe("not-due");
    expect((await w.read.history(s)).map((x) => x.weekStart)).toEqual(["2026-10-26"]);
    expect(w.notices()).toEqual([expect.objectContaining({ key: "2026-10-26" })]);
  });

  it("до 09:00 понедельника новая неделя ещё не наступила: берётся прошлый понедельник — неделя 19–25 октября", async () => {
    const { w, s } = await setup();
    at("2026-11-02", "08:00");
    await w.run(s);
    expect((await w.read.latest(s))?.weekStart).toBe("2026-10-19");
  });

  it("компьютер был выключен в понедельник: в четверг один общий итог за ту же неделю, а через три недели — один итог за последнюю, не три", async () => {
    const { w, s } = await setup();
    at("2026-11-05", "12:00");
    expect(await w.run(s)).toBe("created");
    expect((await w.read.latest(s))?.weekStart).toBe("2026-10-26");
    at("2026-11-23", "10:00");
    expect(await w.run(s)).toBe("created");
    expect((await w.read.history(s)).map((x) => x.weekStart)).toEqual(["2026-11-16", "2026-10-26"]);
    expect(w.notices()).toHaveLength(2);
  });

  it("свой день и время (пятница 18:30): до этого момента — прошлая пятница, после — новая; выключенная сводка не делается совсем", async () => {
    const { w, s } = await setup();
    await w.read.setPreferences(s, { enabled: true, weekday: 5, time: "18:30" });
    at("2026-11-06", "18:00");
    await w.run(s);
    expect((await w.read.latest(s))?.weekStart).toBe("2026-10-19");
    at("2026-11-06", "18:31");
    await w.run(s);
    expect((await w.read.latest(s))?.weekStart).toBe("2026-10-26");

    await w.read.setPreferences(s, { enabled: false, weekday: 5, time: "18:30" });
    at("2026-11-23", "10:00");
    expect(await w.run(s)).toBe("off");
    expect((await w.read.history(s)).map((x) => x.weekStart)).toEqual(["2026-10-26", "2026-10-19"]);
  });

  it("операций нет — сводки нет и уведомления нет, неделя отмечена обработанной (повтор — «не пора»)", async () => {
    const { w, s } = await setup({ history: false });
    expect(await w.run(s)).toBe("empty");
    expect(await w.run(s)).toBe("not-due");
    expect(await w.read.latest(s)).toBeNull();
    expect(w.notices()).toEqual([]);
  });
});

describe("WEEK-03: настройки", () => {
  it("по умолчанию — включено, понедельник, 09:00; чтение создаёт строку настроек пользователя (он попадает в обход)", async () => {
    const { w, s } = await setup({ history: false });
    expect(await w.read.preferences(s)).toEqual({ enabled: true, weekday: 1, time: "09:00" });
    const rows = await db.owner.query(
      "select count(*)::int as n from weekly_preferences where household_id = $1",
      [s.scope.householdId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("сохранённые день и время возвращаются; чужая сводка и чужие настройки не видны", async () => {
    const { w, s } = await setup();
    await w.run(s);
    await w.read.setPreferences(s, { enabled: false, weekday: 7, time: "20:15" });
    expect(await w.read.preferences(s)).toEqual({ enabled: false, weekday: 7, time: "20:15" });
    const stranger = w.s();
    expect(await w.read.latest(stranger)).toBeNull();
    expect(await w.read.preferences(stranger)).toEqual({
      enabled: true,
      weekday: 1,
      time: "09:00",
    });
  });
});

describe("DEMO-01: история итогов недели без модели", () => {
  it("три прошлые недели — три итога по шаблону, модель не вызывалась, уведомлений нет, у чисел есть traceId", async () => {
    const { w, s } = await setup();
    expect(await w.backfill(s, { weeks: 3 })).toBe(3);
    const history = await w.read.history(s);
    expect(history.map((x) => x.weekStart)).toEqual(["2026-10-26", "2026-10-19", "2026-10-12"]);
    expect(history.every((x) => x.textSource === "template")).toBe(true);
    expect(history[0]?.spent.amount).toEqual(byn(31_200));
    expect(history[1]?.spent.amount).toEqual(byn(26_441));
    const trace = await w.r.t.explain.get(s, history[0]?.spent.traceId as never);
    expect(trace.trace.value).toEqual(byn(31_200));
    expect(w.calls).toHaveLength(0);
    expect(w.notices()).toHaveLength(0);
  });

  it("повтор не дублирует недели; недели до первой операции пропускаются", async () => {
    const { w, s } = await setup({ history: false });
    await w.r.seed(s, LAST_WEEK);
    expect(await w.backfill(s, { weeks: 4 })).toBe(1);
    expect(await w.backfill(s, { weeks: 4 })).toBe(0);
    expect((await w.read.history(s)).map((x) => x.weekStart)).toEqual(["2026-10-26"]);
  });

  it("лимиты недели — за месяц конца этой недели: кафе 1 ноября — 85 % у недели 26.10–01.11, у недели 19–25.10 (октябрь) лимитов нет", async () => {
    const { w, s } = await setup();
    await w.a.limits.set(s, { categoryKey: "system:cafes", limit: byn(20_000) } as never, "web");
    await w.backfill(s, { weeks: 2 });
    const history = await w.read.history(s);
    expect(history.find((x) => x.weekStart === "2026-10-26")?.limits).toMatchObject([
      { name: "Кафе, рестораны и доставка", percent: 85 },
    ]);
    expect(history.find((x) => x.weekStart === "2026-10-19")?.limits).toEqual([]);
  });
});
