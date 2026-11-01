// CAL-01, CAL-03, CAL-04, CAL-06, CAL-07, NFR-22, P5, AGT-07 на Postgres: свои события с «Отменить» и удалением через решение «Да»,
// напоминания за 7 и 1 день и тик по FakeClock (в том числе пропуск при выключенном компьютере), гарантии по чекам со сроком из
// настоящей таблицы ставок, платежи и кредиты из `recurring` при запросе без копий в таблице событий.
import { CalendarEventId } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crossTenant } from "../../../platform/db/cross-tenant.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { findReminderOwners } from "../infrastructure/db/calendar.repo.ts";
import { calendarWithJournal, clock } from "../../../main/__fixtures__/calendar-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const TODAY = "2026-10-28";
const day = (iso: string) => LocalDate.parse(iso);
const byn = (minor: number) => ({ minor, currency: "BYN" });

function stand(options: { rateUp?: boolean } = {}) {
  clock.set(`${TODAY}T09:00:00Z`);
  return calendarWithJournal(db, options);
}

const remindersOf = async (eventId: string) =>
  (
    await db.owner.query<{ offset_days: number; due_at: Date; status: string }>(
      "select offset_days, due_at, status from calendar_reminders where event_id = $1 order by offset_days desc",
      [eventId],
    )
  ).rows.map((row) => ({
    offset: row.offset_days,
    dueAt: row.due_at.toISOString(),
    status: row.status,
  }));

describe("CAL-06, CAL-07: своё событие — «напомни 1 декабря оплатить садик»", () => {
  it("создаётся с напоминаниями за 7 и 1 день в 09:00 по Минску; видно в месяце, у суммы есть traceId", async () => {
    const { s, events, read } = stand();
    const { event, undoToken } = await events.create(
      s,
      { title: "Оплатить садик", on: day("2026-12-01"), amount: byn(12_000), type: "own" },
      "web",
    );
    expect(event).toMatchObject({
      type: "own",
      title: "Оплатить садик",
      on: "2026-12-01",
      amount: byn(12_000),
      direction: "out",
      stored: true,
      remindDays: [7, 1],
      canDelete: true,
      origin: { kind: "user" },
    });
    expect(event.traceId).toEqual(expect.any(String));
    expect(undoToken).toEqual(expect.any(String));
    expect(await remindersOf(event.id)).toEqual([
      { offset: 7, dueAt: "2026-11-24T06:00:00.000Z", status: "pending" },
      { offset: 1, dueAt: "2026-11-30T06:00:00.000Z", status: "pending" },
    ]);
    const month = await read.month(s, { month: "2026-12" });
    expect(month.entries.map((e) => [e.id, e.on])).toContainEqual([event.id, "2026-12-01"]);
    expect(month.totals.payments).toMatchObject({ amount: byn(12_000) });
  }, 30_000);

  it("через ассистента: источник «chat», те же напоминания; день в прошлом — VALIDATION", async () => {
    const { s, events } = stand();
    const { event } = await events.create(
      s,
      { title: "Оплатить кружок", on: day("2026-12-01"), type: "own" },
      "web",
      "chat",
    );
    expect(event.origin.kind).toBe("chat");
    expect(event.amount).toBeNull();
    await expect(
      events.create(s, { title: "Вчера", on: day("2026-10-27"), type: "own" }, "web"),
    ).rejects.toMatchObject({ code: "VALIDATION", params: { field: "on" } });
    await expect(
      events.create(
        s,
        { title: "Минус", on: day("2026-12-01"), amount: byn(0), type: "own" },
        "web",
      ),
    ).rejects.toBeInstanceOf(AppError);
  }, 30_000);

  it("«Отменить» убирает событие и его напоминания", async () => {
    const { r, s, events, read } = stand();
    const { event, undoToken } = await events.create(
      s,
      { title: "Оплатить садик", on: day("2026-12-01"), type: "own" },
      "web",
    );
    expect(await r.t.actions.undo(s, undoToken)).toBe("undone");
    expect((await read.month(s, { month: "2026-12" })).entries).toEqual([]);
    expect(await remindersOf(event.id)).toEqual([]);
  }, 30_000);

  it("удаление — только решение «Да/Нет»: до ответа событие на месте; «Да» удаляет, «Отменить» возвращает с тем же id и напоминаниями", async () => {
    const { r, s, events, read } = stand();
    const { event } = await events.create(
      s,
      { title: "Оплатить садик", on: day("2026-12-01"), type: "own" },
      "web",
    );
    const decisionId = await events.requestDelete(s, event.id);
    expect((await read.month(s, { month: "2026-12" })).entries).toHaveLength(1);
    const answer = await r.t.actions.answer(s, decisionId, "yes", "web");
    expect(answer.status).toBe("yes");
    expect((await read.month(s, { month: "2026-12" })).entries).toEqual([]);
    expect(await remindersOf(event.id)).toEqual([]);
    expect(answer.undoToken).toEqual(expect.any(String));
    await r.t.actions.undo(s, answer.undoToken as string);
    const back = (await read.month(s, { month: "2026-12" })).entries;
    expect(back.map((e) => e.id)).toEqual([event.id]);
    expect(await remindersOf(event.id)).toHaveLength(2);
  }, 30_000);

  it("«Нет» ничего не меняет; чужое и несуществующее — NOT_FOUND", async () => {
    const { r, s, events, read } = stand();
    const { event } = await events.create(
      s,
      { title: "Оплатить садик", on: day("2026-12-01"), type: "own" },
      "web",
    );
    const decisionId = await events.requestDelete(s, event.id);
    await r.t.actions.answer(s, decisionId, "no", "web");
    expect((await read.month(s, { month: "2026-12" })).entries).toHaveLength(1);
    await expect(events.requestDelete(s, randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const other = r.s();
    await expect(events.requestDelete(other, event.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  }, 30_000);

  it("правка дня и напоминаний: новые напоминания, «Отменить» возвращает прежние", async () => {
    const { r, s, events } = stand();
    const { event } = await events.create(
      s,
      { title: "Оплатить садик", on: day("2026-12-01"), type: "own" },
      "web",
    );
    const changed = await events.update(
      s,
      { id: event.id as never, on: day("2026-12-10"), remindDays: [30, 0] },
      "web",
    );
    expect(changed.event).toMatchObject({ on: "2026-12-10", remindDays: [30, 0] });
    expect((await remindersOf(event.id)).map((x) => x.offset)).toEqual([30, 0]);
    await r.t.actions.undo(s, changed.undoToken);
    expect(await remindersOf(event.id)).toEqual([
      { offset: 7, dueAt: "2026-11-24T06:00:00.000Z", status: "pending" },
      { offset: 1, dueAt: "2026-11-30T06:00:00.000Z", status: "pending" },
    ]);
  }, 30_000);
});

describe("CAL-07, NFR-22: тик напоминаний", () => {
  async function eventOn(on: string) {
    const x = stand();
    const { event } = await x.events.create(
      x.s,
      { title: "Оплатить садик", on: day(on), type: "own" },
      "web",
    );
    return { ...x, event };
  }

  it("за 7 дней до события — одно уведомление в 09:00 по Минску; повторный тик второго не шлёт", async () => {
    const { s, reminders, calendarNotices, event } = await eventOn("2026-11-05");
    clock.set("2026-10-29T05:59:00Z");
    expect(await reminders.deliver(s)).toBe(0);
    clock.set("2026-10-29T06:00:00Z");
    expect(await reminders.deliver(s)).toBe(1);
    expect(await reminders.deliver(s)).toBe(0);
    expect(calendarNotices()).toHaveLength(1);
    expect(calendarNotices()[0]).toMatchObject({
      objectRef: { entity: "calendar-event", id: event.id },
      params: { type: "own", title: "Оплатить садик", days: 7, on: "2026-11-05" },
    });
    expect((await remindersOf(event.id)).map((x) => [x.offset, x.status])).toEqual([
      [7, "sent"],
      [1, "pending"],
    ]);
  }, 30_000);

  it("компьютер был выключен до дня события: «за 7» и «за 1» наступили разом — придёт одно, «за 7» пропущено", async () => {
    const { s, reminders, calendarNotices, event } = await eventOn("2026-11-05");
    clock.set("2026-11-05T10:00:00Z");
    expect(await reminders.deliver(s)).toBe(1);
    expect(calendarNotices()).toHaveLength(1);
    expect(calendarNotices()[0]?.params).toMatchObject({ days: 0 });
    expect((await remindersOf(event.id)).map((x) => [x.offset, x.status])).toEqual([
      [7, "skipped"],
      [1, "sent"],
    ]);
  }, 30_000);

  it("событие уже прошло, пока компьютер был выключен, — задним числом ничего не шлётся", async () => {
    const { s, reminders, calendarNotices, event } = await eventOn("2026-11-05");
    clock.set("2026-11-07T10:00:00Z");
    expect(await reminders.deliver(s)).toBe(0);
    expect(calendarNotices()).toEqual([]);
    expect((await remindersOf(event.id)).map((x) => x.status)).toEqual(["skipped", "skipped"]);
  }, 30_000);

  it("чужие напоминания не отправляются: тик одного пользователя не трогает другого", async () => {
    const mine = await eventOn("2026-11-05");
    const other = mine.r.s();
    clock.set("2026-11-05T10:00:00Z");
    expect(await mine.reminders.deliver(other)).toBe(0);
    expect(mine.calendarNotices()).toEqual([]);
    expect(await mine.reminders.deliver(mine.s)).toBe(1);
  }, 30_000);
});

describe("NFR-22: обход «кому слать» — владельцы неотправленных напоминаний", () => {
  const owners = () => crossTenant(db.pool, "calendar.deliver-reminders-sweep", findReminderOwners);

  it("у пользователя с несколькими событиями и напоминаниями — одна строка; после отправки всех — его нет", async () => {
    const { s, events, reminders } = stand();
    await events.create(s, { title: "Раз", on: day("2026-11-05"), type: "own" }, "web");
    await events.create(s, { title: "Два", on: day("2026-11-06"), type: "own" }, "web");
    const mine = (await owners()).filter((row) => row.householdId === s.scope.householdId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.userId).toBe(s.scope.userId);
    clock.set("2026-11-07T10:00:00Z");
    await reminders.deliver(s);
    expect((await owners()).filter((row) => row.householdId === s.scope.householdId)).toEqual([]);
  }, 30_000);
});

describe("CAL-04, RCPT-13: гарантия по чеку — 24 месяца из таблицы ставок", () => {
  it("наушники от 18.11.2024 → конец гарантии 18.11.2026, напоминания за 7 и 1 день (30 дней уже прошли); повтор события дубль не создаёт", async () => {
    const { s, warranty, read, warrantyReceipt } = stand();
    const receipt = await warrantyReceipt(s, "2024-11-18", "Наушники");
    expect(await warranty.sync(s, [receipt.id])).toBe(1);
    expect(await warranty.sync(s, [receipt.id])).toBe(0);
    const month = await read.month(s, { month: "2026-11" });
    const entry = month.entries.find((e) => e.type === "warranty");
    expect(entry).toMatchObject({
      title: "Наушники",
      on: "2026-11-18",
      amount: null,
      stored: true,
      remindDays: [30, 7, 1],
      canDelete: false,
      origin: {
        kind: "warranty",
        params: { store: "Электросила", purchasedOn: "2024-11-18", months: 24 },
      },
      ref: { entity: "receipt", id: receipt.id },
    });
    expect((await remindersOf(entry?.id ?? "")).map((x) => [x.offset, x.dueAt])).toEqual([
      [7, "2026-11-11T06:00:00.000Z"],
      [1, "2026-11-17T06:00:00.000Z"],
    ]);
  }, 30_000);

  it("свежая покупка: пылесос от 03.05.2026 → 03.05.2028, напоминание за 30 дней; в списке — группа «Позже»", async () => {
    const { s, warranty, read, warrantyReceipt } = stand();
    const receipt = await warrantyReceipt(s, "2026-05-03", "Пылесос", null);
    await warranty.sync(s, [receipt.id]);
    const { groups } = await read.upcoming(s);
    const later = groups.find((g) => g.key === "later");
    expect(later?.entries.map((e) => [e.title, e.on, e.remindDays])).toEqual([
      ["Пылесос", "2028-05-03", [30, 7, 1]],
    ]);
  }, 30_000);

  it("гарантия, которая уже закончилась, события не получает", async () => {
    const { s, warranty, warrantyReceipt } = stand();
    const receipt = await warrantyReceipt(s, "2020-01-10", "Чайник");
    expect(await warranty.sync(s, [receipt.id])).toBe(0);
  }, 30_000);

  it("нет подтверждённого срока в таблице — события нет и числа из головы нет; подтвердили — создаётся", async () => {
    const withoutRate = stand({ rateUp: false });
    const receipt = await withoutRate.warrantyReceipt(withoutRate.s, "2026-05-03", "Телевизор");
    expect(await withoutRate.warranty.sync(withoutRate.s, [receipt.id])).toBe(0);
    const withRate = stand();
    await withRate.warrantyReceipt(withRate.s, "2026-05-03", "Телевизор");
    expect(await withRate.sync.run(withRate.s)).toBe(1);
  }, 30_000);

  it("при открытии календаря недостающие гарантии создаются сами (событие могло прийти раньше срока в таблице)", async () => {
    const { s, read, warrantyReceipt } = stand();
    await warrantyReceipt(s, "2026-05-03", "Холодильник");
    const { groups } = await read.upcoming(s);
    expect(groups.flatMap((g) => g.entries).map((e) => e.title)).toContain("Холодильник");
  }, 30_000);
});

describe("CAL-03, REC-03, CAL-01: платежи, кредиты и поступления — из recurring при запросе", () => {
  async function withHistory() {
    const x = stand();
    const history = x.r.generateHistory({ seed: 7, today: TODAY });
    await x.r.seed(x.s, history.operations);
    await x.r.recompute(x.s);
    return x;
  }

  it("ноябрь: кредит 23.11 — тип «кредит», зарплата 25.11 — «доход»; в таблице событий ничего не появилось", async () => {
    const { s, read } = await withHistory();
    const month = await read.month(s, { month: "2026-11" });
    const credit = month.entries.find((e) => e.type === "credit" && e.on === "2026-11-23");
    expect(credit).toMatchObject({ stored: false, direction: "out", canDelete: false });
    expect(credit?.traceId).toEqual(expect.any(String));
    const salary = month.entries.find((e) => e.type === "income" && e.on === "2026-11-25");
    expect(salary).toMatchObject({ direction: "in", amount: byn(144_000) });
    const stored = await db.owner.query("select 1 from calendar_events where household_id = $1", [
      s.scope.householdId,
    ]);
    expect(stored.rows).toEqual([]);
  }, 60_000);

  it("итоги месяца — суммы платежей и поступлений с traceId: сохранённый расчёт — сумма слагаемых", async () => {
    const { r, s, read } = await withHistory();
    const month = await read.month(s, { month: "2026-11" });
    const out = month.entries
      .filter(
        (e) =>
          e.direction === "out" && e.on !== null && e.on >= "2026-11-01" && e.on <= "2026-11-30",
      )
      .reduce((sum, e) => sum + (e.amount?.minor ?? 0), 0);
    expect(month.totals.payments?.amount.minor).toBe(out);
    const stored = await r.t.explain.get(s, month.totals.payments?.traceId ?? "");
    expect(stored.trace).toMatchObject({ key: "calendar.paymentsTotal", value: byn(out) });
  }, 60_000);

  it("прошлые дни — платежи из истории («платёж найден в операциях»), будущие — прогноз; границы месяца не дублируют записи", async () => {
    const { s, read } = await withHistory();
    const october = await read.month(s, { month: "2026-10" });
    const past = october.entries.filter(
      (e) => e.on !== null && e.on < TODAY && e.type === "credit",
    );
    expect(past.map((e) => e.on)).toContain("2026-10-23");
    const ids = october.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);

  it("список «Ближайшие»: эта неделя, следующая, ноябрь; у группы — сумма с traceId", async () => {
    const { s, read } = await withHistory();
    const { groups } = await read.upcoming(s);
    expect(groups.map((g) => g.key).slice(0, 3)).toEqual(["week-0", "week-1", "month-2026-11"]);
    const november = groups.find((g) => g.key === "month-2026-11");
    expect(november?.totals.payments?.traceId).toEqual(expect.any(String));
  }, 60_000);

  it("месяц вне формата — VALIDATION", async () => {
    const { s, read } = stand();
    await expect(read.month(s, { month: "2026-13" })).rejects.toMatchObject({ code: "VALIDATION" });
  }, 30_000);
});

describe("P1: пустой календарь", () => {
  it("нет событий — итогов нет (null), а не ноль; сетка октября 2026 — с 28 сентября по 1 ноября", async () => {
    const { s, read } = stand();
    const month = await read.month(s, { month: "2026-10" });
    expect(month).toMatchObject({
      from: "2026-09-28",
      to: "2026-11-01",
      entries: [],
      totals: { payments: null, income: null },
    });
  }, 30_000);
});

describe("CAL-06, AGT-05: инструменты агента create_event и list_events", () => {
  it("«напомни 1 декабря оплатить кружок»: событие создано ассистентом, с undoToken; дальше его видно в list_events", async () => {
    const { r, s, tools } = stand();
    const ctx = { s, requestId: "r-1", channel: "web" as const };
    const input = tools.createEvent.input.parse({ title: "Оплатить кружок", on: "2026-12-01" });
    const created = await tools.createEvent.execute(ctx, input);
    expect(tools.createEvent.output.parse(created)).toMatchObject({
      event: {
        title: "Оплатить кружок",
        on: "2026-12-01",
        origin: { kind: "chat" },
        remindDays: [7, 1],
      },
    });
    const listed = await tools.listEvents.execute(
      ctx,
      tools.listEvents.input.parse({ from: "2026-11-25", to: "2026-12-05" }),
    );
    expect(tools.listEvents.output.parse(listed).entries.map((e) => e.title)).toEqual([
      "Оплатить кружок",
    ]);
    expect(await r.t.actions.undo(s, created.undoToken)).toBe("undone");
  }, 30_000);

  it("день в прошлом — ошибка VALIDATION, которую агент увидит кодом; лишних полей во входе нет", async () => {
    const { s, tools } = stand();
    const ctx = { s, requestId: "r-2", channel: "web" as const };
    await expect(
      tools.createEvent.execute(
        ctx,
        tools.createEvent.input.parse({ title: "Давно", on: "2026-01-01" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(() =>
      tools.createEvent.input.parse({ title: "x", on: "2026-12-01", userId: "u" }),
    ).toThrow(/userId|Unrecognized|unrecognized/u);
    expect(Object.keys(tools.createEvent.input.shape)).not.toContain("userId");
  }, 30_000);
});

const eventsOf = async (s: { scope: { householdId: unknown } }, rule: string) =>
  (
    await db.owner.query<{
      id: string;
      day: string | null;
      key: string;
      origin: string;
      type: string;
      params: Record<string, string | number>;
    }>(
      "select id, to_char(day, 'YYYY-MM-DD') as day, key, origin, type, params from calendar_events where rule = $1 and household_id = $2 order by day nulls last",
      [rule, s.scope.householdId],
    )
  ).rows;

describe("CAL-02: сроки налогов — только по фактам профиля и подтверждённым значениям таблицы", () => {
  it("«есть автомобиль» → транспортный налог 15.11.2026 (ст. 307⁸ п. 2), напоминания за 7 и 1 день; повторный пересчёт дубль не создаёт", async () => {
    const { s, setFact, sync, read } = stand();
    expect(await sync.run(s)).toBe(0);
    await setFact(s, { key: "property.car", value: true });
    expect(await sync.run(s)).toBe(2);
    expect(await sync.run(s)).toBe(0);
    const [tax] = await eventsOf(s, "transport-tax");
    expect(tax).toMatchObject({
      day: "2026-11-15",
      key: "rule:transport-tax:2026",
      origin: "rule",
      type: "tax",
      params: { article: "307⁸", point: "2", confirmedOn: "2026-11-01" },
    });
    expect((await remindersOf(tax?.id ?? "")).map((x) => [x.offset, x.dueAt])).toEqual([
      [7, "2026-11-08T06:00:00.000Z"],
      [1, "2026-11-14T06:00:00.000Z"],
    ]);
    const month = await read.month(s, { month: "2026-11" });
    expect(month.entries.find((e) => e.rule === "transport-tax")).toMatchObject({
      type: "tax",
      title: null,
      on: "2026-11-15",
      stored: true,
      canDelete: false,
      origin: { kind: "rule" },
    });
  }, 30_000);

  it("квартира → налог на недвижимость, участок → земельный: оба 15 ноября, у каждого свой пункт нормы", async () => {
    const { s, setFact, sync } = stand();
    await setFact(s, { key: "property.apartment", value: true });
    await setFact(s, { key: "property.land", value: true });
    await sync.run(s);
    expect((await eventsOf(s, "property-tax"))[0]).toMatchObject({
      day: "2026-11-15",
      params: { article: "233", point: "5" },
    });
    expect((await eventsOf(s, "land-tax"))[0]).toMatchObject({
      day: "2026-11-15",
      params: { article: "244", point: "8.1" },
    });
  }, 30_000);

  it("факт без подтверждения («предположение») и «нет» событий не создают", async () => {
    const { s, setFact, sync } = stand();
    await setFact(s, { key: "property.car", value: true }, "assumed");
    await setFact(s, { key: "property.land", value: false });
    expect(await sync.run(s)).toBe(0);
    expect(await eventsOf(s, "transport-tax")).toEqual([]);
    expect(await eventsOf(s, "land-tax")).toEqual([]);
  }, 30_000);

  it("срок не подтверждён в таблице — события нет, числа из головы нет", async () => {
    const { s, setFact, sync } = stand({ rateUp: false });
    await setFact(s, { key: "property.apartment", value: true });
    expect(await sync.run(s)).toBe(0);
    expect(await eventsOf(s, "property-tax")).toEqual([]);
  }, 30_000);

  it("факт сменился на «нет» — будущие события правила уходят, а событие, которое уже прошло, остаётся историей", async () => {
    const { s, setFact, sync } = stand();
    await setFact(s, { key: "property.car", value: true });
    await sync.run(s);
    expect(await eventsOf(s, "transport-tax")).toHaveLength(1);
    await setFact(s, { key: "property.car", value: false });
    await sync.run(s);
    expect(await eventsOf(s, "transport-tax")).toEqual([]);
    expect(await eventsOf(s, "inspection")).toEqual([]);
  }, 30_000);

  it("норма изменилась (подтверждено 16 ноября) — день следует за таблицей; перенесённое человеком событие не трогается", async () => {
    const { s, setFact, sync, events } = stand();
    await setFact(s, { key: "property.apartment", value: true });
    await setFact(s, { key: "property.land", value: true });
    await sync.run(s);
    const [land] = await eventsOf(s, "land-tax");
    await events.update(
      s,
      { id: CalendarEventId.parse(land?.id), on: LocalDate.parse("2026-11-10") },
      "web",
    );
    await db.owner.query(
      "update norm_rates set value = 1116 where param in ('deadline.property-tax', 'deadline.land-tax')",
    );
    try {
      await sync.run(s);
      expect((await eventsOf(s, "property-tax"))[0]?.day).toBe("2026-11-16");
      expect((await eventsOf(s, "land-tax"))[0]?.day).toBe("2026-11-10");
    } finally {
      await db.owner.query(
        "update norm_rates set value = 1115 where param in ('deadline.property-tax', 'deadline.land-tax')",
      );
    }
  }, 30_000);

  it("НПД → 22-е число каждого месяца, шесть ближайших; ИП → декларация до 31.03.2027", async () => {
    const { s, setFact, sync } = stand();
    await setFact(s, { key: "employment", types: ["npd", "ip"] });
    await sync.run(s);
    expect((await eventsOf(s, "npd-payment")).map((e) => e.day)).toEqual([
      "2026-11-22",
      "2026-12-22",
      "2027-01-22",
      "2027-02-22",
      "2027-03-22",
      "2027-04-22",
    ]);
    expect((await eventsOf(s, "declaration")).map((e) => [e.day, e.key])).toEqual([
      ["2027-03-31", "rule:declaration:2027"],
    ]);
  }, 30_000);

  it("найденный вычет (образование, 2026) → «Подать декларацию до 31.03.2027» по ст. 222; вычет отклонён — события нет", async () => {
    const { s, sync, found } = stand();
    found.push({ kind: "education", year: 2026 }, { kind: "children", year: 2026 });
    await sync.run(s);
    const events = await eventsOf(s, "declaration-deduction");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      day: "2027-03-31",
      key: "rule:declaration-deduction:2027",
      params: { article: "222", point: "1", year: 2026 },
    });
    found.length = 0;
    await sync.run(s);
    expect(await eventsOf(s, "declaration-deduction")).toEqual([]);
  }, 30_000);

  it("техосмотр: правило без даты — событие без дня и без напоминаний; день назвал человек — напоминания появились", async () => {
    const { s, setFact, sync, read, events } = stand();
    await setFact(s, { key: "property.car", value: true });
    await sync.run(s);
    const [inspection] = await eventsOf(s, "inspection");
    expect(inspection).toMatchObject({ day: null, key: "rule:inspection", type: "own" });
    expect(await remindersOf(inspection?.id ?? "")).toEqual([]);
    const { groups } = await read.upcoming(s);
    expect(groups[0]?.key).toBe("undated");
    expect(groups[0]?.entries.map((e) => [e.rule, e.on])).toEqual([["inspection", null]]);
    await events.update(
      s,
      { id: CalendarEventId.parse(inspection?.id), on: LocalDate.parse("2027-02-10") },
      "web",
    );
    expect((await remindersOf(inspection?.id ?? "")).map((x) => x.offset)).toEqual([7, 1]);
    await sync.run(s);
    expect((await eventsOf(s, "inspection"))[0]?.day).toBe("2027-02-10");
  }, 30_000);
});

const spend = (
  date: string,
  merchant: string,
  category: string,
  amountMinor = 5000,
): Parameters<ReturnType<typeof calendarWithJournal>["r"]["seed"]>[1][number] => ({
  date,
  merchant,
  type: "expense",
  amountMinor,
  category,
});

describe("PROF-07: имущество выводится из операций и спрашивается один раз", () => {
  it("первое открытие календаря без признаков — один вопрос про автомобиль; «Нет» — факт, второй раз не спрашивается, событий нет", async () => {
    const { s, properties, sync } = stand();
    expect(await properties.question(s)).toEqual({ kind: "car", evidence: null });
    await properties.answer(s, { kind: "car", has: false });
    await sync.run(s);
    expect(await properties.question(s)).toBeNull();
    expect(await eventsOf(s, "transport-tax")).toEqual([]);
  }, 30_000);

  it("расходы на топливо → предположение «есть автомобиль» (топливо), событий до ответа нет; «Да» — налог и техосмотр, «Отменить» возвращает предположение", async () => {
    const { s, r, properties, sync } = stand();
    await r.seed(s, [spend("2026-10-02", "АЗС Белоруснефть", "car")]);
    await sync.run(s);
    expect(await properties.question(s)).toEqual({ kind: "car", evidence: "fuel" });
    expect(await eventsOf(s, "transport-tax")).toEqual([]);
    const { undoToken } = await properties.answer(s, { kind: "car", has: true });
    await sync.run(s);
    expect(await properties.question(s)).toBeNull();
    expect((await eventsOf(s, "transport-tax"))[0]?.day).toBe("2026-11-15");
    expect(await eventsOf(s, "inspection")).toHaveLength(1);
    await r.t.actions.undo(s, undoToken);
    await sync.run(s);
    expect(await properties.question(s)).toEqual({ kind: "car", evidence: "fuel" });
    expect(await eventsOf(s, "transport-tax")).toEqual([]);
  }, 30_000);

  it("уплата налога на недвижимость в операциях → предположение «есть квартира» (налог); повторный пересчёт факт не дублирует", async () => {
    const { s, r, properties, sync } = stand();
    await r.seed(s, [spend("2026-09-20", "Налог на недвижимость, ЕРИП", "taxes", 8000)]);
    await sync.run(s);
    await sync.run(s);
    expect(await properties.question(s)).toEqual({ kind: "apartment", evidence: "tax" });
    const rows = await db.owner.query<{ n: string }>(
      "select count(*) as n from profile_facts where household_id = $1 and value->>'key' = 'property.apartment'",
      [s.scope.householdId],
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  }, 30_000);
});
