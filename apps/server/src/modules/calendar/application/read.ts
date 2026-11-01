// Чтение календаря (CAL-01, CAL-03, REC-03): хранимые события плюс платежи и поступления из `recurring` — они читаются при
// запросе и в таблицу событий не копируются. До «сегодня» регулярные платежи — операции-основания из истории («платёж найден в
// операциях»), с «сегодня» — прогноз по истории. Суммы и итоги — `calc` с трассой, пачкой на запрос.
import {
  CALENDAR_MAX_ENTRIES,
  type CalendarMonthView,
  type CalendarRange,
  type CalendarUpcoming,
} from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { groupBounds, monthGrid } from "../domain/dates.ts";
import { listEventsBetween, listUndated } from "../infrastructure/db/calendar.repo.ts";
import { UPCOMING_DAYS } from "../settings.ts";
import type { Deps } from "./deps.ts";
import { finalize, pastItems, sortItems, storedItem, upcomingItem, type Item } from "./entries.ts";

const monthOf = (day: LocalDate) => day.slice(0, 7);

export function makeRead(d: Deps, ensureSynced: (s: ScopedDb) => Promise<void>) {
  const { clock, settings } = d.platform;

  /** События с днём в `from…to`: хранимые, прошедшие и ожидаемые платежи; `to = null` — только хранимые, без конца. */
  async function collect(
    s: ScopedDb,
    from: LocalDate,
    to: LocalDate | null,
    recurringTo: LocalDate | null,
  ): Promise<Item[]> {
    const today = clock.today();
    const stored = (await listEventsBetween(s, from, to, CALENDAR_MAX_ENTRIES)).map(storedItem);
    const items: Item[] = [...stored];
    const last = recurringTo ?? to;
    if (last !== null) {
      if (from < today) {
        const entries = await d.recurring.list(s, { onDate: today });
        const pastTo = LocalDate.addDays(today, -1);
        for (const entry of entries) {
          items.push(...pastItems(entry, from, last < pastTo ? last : pastTo));
        }
      }
      if (last >= today) {
        const payments = await d.recurring.upcoming(s, {
          from: from > today ? from : today,
          to: last,
        });
        items.push(...payments.map(upcomingItem));
      }
    }
    return sortItems(items).slice(0, CALENDAR_MAX_ENTRIES);
  }

  /** CAL-01: месяц — сетка с понедельника по воскресенье; итоги — по дням самого месяца. */
  async function month(
    s: ScopedDb,
    input: { month?: string | undefined },
  ): Promise<CalendarMonthView> {
    await ensureSynced(s);
    const today = clock.today();
    const key = input.month ?? monthOf(today);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(key)) throw new AppError("VALIDATION", { field: "month" });
    const { from, to } = monthGrid(key);
    const items = await collect(s, from, to, to);
    const { entries, totals } = await finalize(
      s,
      d.explain,
      items,
      LocalDate.parse(`${key}-01`),
      lastDayOf(key),
    );
    return { today, month: key, from, to, entries, totals };
  }

  /** CAL-01: список «Ближайшие» — эта неделя, следующая, месяцы дальше, «Позже» (хранимые события любой даты). */
  async function upcoming(s: ScopedDb): Promise<CalendarUpcoming> {
    await ensureSynced(s);
    const today = clock.today();
    const horizon = LocalDate.addDays(today, await settings.get(UPCOMING_DAYS));
    const bounds = groupBounds(today, horizon);
    const items = await collect(s, today, null, horizon);
    const undated = (await listUndated(s)).map(storedItem);
    const groups = [];
    for (const bound of bounds) {
      const inGroup = items.filter((item) => {
        const on = item.entry.on;
        return on !== null && on >= bound.from && (bound.to === null || on <= bound.to);
      });
      if (inGroup.length === 0) continue;
      const { entries, totals } = await finalize(
        s,
        d.explain,
        inGroup,
        bound.from,
        bound.to ?? LocalDate.parse("9999-12-31"),
      );
      groups.push({
        key: bound.key,
        from: bound.from,
        to: bound.to,
        entries,
        totals,
      });
    }
    if (undated.length > 0) {
      const { entries, totals } = await finalize(s, d.explain, undated, today, today);
      groups.unshift({ key: "undated", from: today, to: null, entries, totals });
    }
    return { today, groups };
  }

  /** Диапазон для агента и главной: плоский список с итогами. */
  async function range(
    s: ScopedDb,
    input: { from?: LocalDate | undefined; to?: LocalDate | undefined },
  ): Promise<CalendarRange> {
    await ensureSynced(s);
    const today = clock.today();
    const from = input.from ?? today;
    const to = input.to ?? LocalDate.addDays(from, 30);
    if (to < from) throw new AppError("VALIDATION", { field: "to" });
    const items = await collect(s, from, to, to);
    const { entries, totals } = await finalize(s, d.explain, items, from, to);
    return { today, from, to, entries, totals };
  }

  /** Главная (DASH-02): ближайшие хранимые события на `days` дней вперёд — налоги, гарантии, страховки, свои. */
  async function homeEvents(s: ScopedDb, days: number, limit: number) {
    await ensureSynced(s);
    const today = clock.today();
    const stored = (await listEventsBetween(s, today, LocalDate.addDays(today, days), limit)).map(
      storedItem,
    );
    const { entries } = await finalize(s, d.explain, stored, today, today);
    return entries;
  }

  return { month, upcoming, range, homeEvents };
}

function lastDayOf(month: string): LocalDate {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return LocalDate.parse(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
}

export type Read = ReturnType<typeof makeRead>;
