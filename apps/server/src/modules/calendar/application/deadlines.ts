// Сроки налогов граждан (CAL-02): событие по правилу создаётся, когда факт профиля включает правило, а срок подтверждён в таблице
// ставок (`deadline.*`, норма НК). Событие одно на (правило, год) — ключ `rule:<правило>:<год>` (НПД — месяц), повторный пересчёт дубль
// не создаёт; день, если норма изменилась и человек его не двигал, обновляется вслед за таблицей. Выключился факт («нет автомобиля») —
// будущие события правила уходят. Нет подтверждённого срока — события нет и ничего не удаляется. Правило без даты (техосмотр) —
// событие без дня: день укажет человек (дату не выдумываем). Пересчёт зовут по `profile.facts-changed`, `norm-tables.values-confirmed`
// и при открытии календаря и главной (`sync.ensure`): найденные вычеты (`tax`) событий не публикуют.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import {
  DEADLINE_RULES,
  eventKey,
  ruleDays,
  ruleOfKey,
  type DeadlineRule,
  type RuleFacts,
} from "../domain/deadline-rules.ts";
import {
  insertEvent,
  listRuleEvents,
  patchEvent,
  removeEvent,
  type EventRow,
} from "../infrastructure/db/calendar.repo.ts";
import type { Deps } from "./deps.ts";
import type { Reminders } from "./reminders.ts";

const FACT_KEYS = ["employment", "property.apartment", "property.land", "property.car"];

export function makeDeadlines(d: Deps, reminders: Reminders) {
  const { clock, realtime, log } = d.platform;

  /** Факты правил: имущество — только подтверждённое человеком («предположение» вопрос ещё ждёт); занятость — как записана. */
  async function ruleFacts(s: ScopedDb): Promise<RuleFacts> {
    const today = clock.today();
    const facts = await d.profile.getFacts(s, FACT_KEYS, today);
    const yes = (key: "property.apartment" | "property.land" | "property.car") =>
      facts.some((f) => f.value.key === key && f.value.value === true && f.status === "confirmed");
    const employment = facts.flatMap((f) => (f.value.key === "employment" ? f.value.types : []));
    // Вычет по образованию и жилью оформляют через ИМНС по декларации (ст. 222); на детей — только у нанимателя.
    const found = await d.tax.activeFound(s);
    const deductionYears = [
      ...new Set(
        found.filter((x) => x.kind === "education" || x.kind === "housing").map((x) => x.year),
      ),
    ];
    return {
      apartment: yes("property.apartment"),
      land: yes("property.land"),
      car: yes("property.car"),
      npd: employment.includes("npd"),
      ip: employment.includes("ip"),
      deductionYears,
    };
  }

  const isFutureOrUndated = (row: EventRow, today: string) => row.day === null || row.day >= today;

  async function drop(s: ScopedDb, rows: readonly EventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await s.transaction(async (tx) => {
      for (const row of rows) await removeEvent(tx, row.id);
      await realtime.changed(tx, { entity: "calendar-event", ids: rows.map((r) => r.id) });
    });
  }

  /** Событие правила на день: создать по ключу или сдвинуть вслед за таблицей, если человек день не менял. */
  async function ensure(
    s: ScopedDb,
    rule: DeadlineRule,
    day: string | null,
    existing: ReadonlyMap<string, EventRow>,
    params: Record<string, string | number>,
  ): Promise<boolean> {
    const key = eventKey(rule, day as never);
    const row = existing.get(key);
    const remindDays = await reminders.defaults("tax");
    if (row !== undefined) {
      if (row.onEdited || row.day === day) return false;
      await s.transaction(async (tx) => {
        await patchEvent(tx, row.id, { day, params });
        await reminders.replan(tx, row.id, { day, remindDays: row.remindDays, dayChanged: true });
        await realtime.changed(tx, { entity: "calendar-event", ids: [row.id] });
      });
      return false;
    }
    const id = await s.transaction(async (tx) => {
      const eventId = await insertEvent(tx, {
        type: rule.cadence === "undated" ? "own" : "tax",
        title: null,
        rule: rule.key,
        day,
        origin: "rule",
        params,
        key,
        remindDays,
      });
      if (eventId === undefined) return undefined;
      await reminders.replan(tx, eventId, { day, remindDays, dayChanged: true });
      await realtime.changed(tx, { entity: "calendar-event", ids: [eventId] });
      return eventId;
    });
    return id !== undefined;
  }

  /** Пересчёт событий правил пользователя; возвращает, сколько создано. */
  async function sync(s: ScopedDb): Promise<number> {
    const today = clock.today();
    const facts = await ruleFacts(s);
    const rows = await listRuleEvents(s);
    let created = 0;
    for (const rule of DEADLINE_RULES) {
      const mine = rows.filter((row) => ruleOfKey(row.key)?.key === rule.key);
      if (!rule.enabled(facts)) {
        // Факт выключился: будущие события правила уходят, прошедшие — история.
        await drop(
          s,
          mine.filter((row) => isFutureOrUndated(row, today)),
        );
        continue;
      }
      const byKey = new Map(mine.map((row) => [row.key ?? "", row]));
      if (rule.param === null) {
        if (await ensure(s, rule, null, byKey, { basis: "fact" })) created += 1;
        continue;
      }
      const rate = await d.normTables.rate(rule.param, today);
      if (!rate.found) continue;
      if (rate.unit !== "month-day" && rate.unit !== "day-of-month") continue;
      const days = ruleDays(rule, rate.unit, rate.value, facts, today);
      const wanted = new Set(days.map((day) => eventKey(rule, day)));
      for (const day of days) {
        const params: Record<string, string | number> = {
          article: rate.source.article ?? "",
          point: rate.source.point ?? "",
          confirmedOn: rate.confirmedOn,
          ...(rule.cadence === "per-deduction" ? { year: Number(day.slice(0, 4)) - 1 } : {}),
        };
        if (await ensure(s, rule, day, byKey, params)) created += 1;
      }
      await drop(
        s,
        mine.filter((row) => !wanted.has(row.key ?? "") && isFutureOrUndated(row, today)),
      );
    }
    if (created > 0) log.info({ count: created }, "calendar.deadline-events-created");
    return created;
  }

  return { sync };
}

export type Deadlines = ReturnType<typeof makeDeadlines>;
