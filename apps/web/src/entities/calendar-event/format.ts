// Подписи события календаря (CAL-01): название, «Откуда это событие», «через N дней», день недели. Всё — словами из словаря,
// даты — календарная арифметика над LocalDate (без Date и Intl): «сегодня» приходит с сервера в ответе.
import type { CalendarEntry } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { LocalDate } from "@kosht/kernel";
import type { TFunction } from "i18next";

export type CalendarT = TFunction<
  readonly ["calendar", "notifications", "decisions", "errors", "common"]
>;

/** Название: своё или позиции чека — как записано; событие по правилу — название правила; иначе тип словами. */
export function eventTitle(
  t: CalendarT,
  entry: Pick<CalendarEntry, "title" | "rule" | "type">,
): string {
  if (entry.title !== null && entry.title !== "") return entry.title;
  if (entry.rule !== null) {
    const name = t(`notifications:kinds.calendar-reminder.rules.${entry.rule}` as never, {
      defaultValue: "",
    });
    if (name !== "") return name;
  }
  return t(`calendar:types.${entry.type}`);
}

/** «ДД» и «месяц ГГГГ» родительным падежом: карточка и список. */
export function dayParts(on: LocalDate): { day: number; month: string; year: string } {
  const [year = "", month = "01", day = "1"] = on.split("-");
  return { day: Number(day), month, year };
}

/** День недели по григорианскому календарю: 0 — воскресенье (опорная дата — воскресенье 2026-01-04). */
export function weekdayOf(on: LocalDate): number {
  const diff = LocalDate.daysBetween(LocalDate.parse("2026-01-04"), on);
  return ((diff % 7) + 7) % 7;
}

/** Название дня недели: «понедельник» (начало — с заглавной в `weekdayNames`, `lower` — со строчной). */
export function weekdayName(t: CalendarT, on: LocalDate, lower = false): string {
  const name: string = t(`calendar:weekdayNames.${String(weekdayOf(on))}` as never);
  return lower ? name.toLowerCase() : name;
}

/** Месяц родительным падежом по номеру «01»…«12»: «октября»; `short` — первые три буквы («окт»). */
export function monthGenitive(t: CalendarT, month: string, short = false): string {
  const name: string = t(`calendar:monthOf.${month}` as never);
  return short ? name.slice(0, 3) : name;
}

/** «Вторник, 1 декабря 2026». */
export function fullDate(t: CalendarT, on: LocalDate): string {
  const { day, month, year } = dayParts(on);
  return t("calendar:event.when", {
    weekday: weekdayName(t, on),
    day,
    month: monthGenitive(t, month),
    year,
  });
}

/** «прошло», «сегодня», «завтра», «через 12 дней», «через 3 месяца». */
export function relativeText(t: CalendarT, on: LocalDate, today: LocalDate): string {
  const days = LocalDate.daysBetween(today, on);
  if (days < 0) return t("calendar:rel.past");
  if (days === 0) return t("calendar:rel.today");
  if (days === 1) return t("calendar:rel.tomorrow");
  if (days <= 60) return t("calendar:rel.days", { count: days });
  return t("calendar:rel.months", { count: Math.round(days / 30.4) });
}

/** «Откуда это событие»: текст по виду источника и параметрам (магазин, день покупки, срок гарантии, имя платежа). */
export function originText(t: CalendarT, entry: Pick<CalendarEntry, "origin" | "rule">): string {
  const { kind, params } = entry.origin;
  const value = (key: string) => String(params[key] ?? "");
  const date = (key: string) => {
    const raw = value(key);
    return /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? formatDate(LocalDate.parse(raw)) : raw;
  };
  switch (kind) {
    case "warranty":
      return t(
        value("store") === "" ? "calendar:origin.warrantyNoStore" : "calendar:origin.warranty",
        {
          store: value("store"),
          purchasedOn: date("purchasedOn"),
          months: value("months"),
        },
      );
    case "recurring":
    case "income":
      return t(`calendar:origin.${kind}`, { name: value("name") });
    case "insurance":
      return t("calendar:origin.insurance", { paidOn: date("paidOn") });
    case "rule": {
      // CAL-02: текст по правилу (факт профиля и норма НК); правило неизвестно сайту — общая подпись.
      const key = `calendar:origin.rules.${entry.rule ?? ""}` as never;
      return t(key, {
        defaultValue: t("calendar:origin.rule"),
        article: value("article"),
        point: value("point"),
        confirmedOn: date("confirmedOn"),
        year: value("year"),
      });
    }
    default:
      return t(`calendar:origin.${kind}`);
  }
}

/** Краткое название дня для подписи ячейки: «21 октября». */
export function cellLabel(t: CalendarT, on: LocalDate): string {
  const { day, month } = dayParts(on);
  return t("calendar:cell.label", { day, month: monthGenitive(t, month) });
}
