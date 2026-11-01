// Календарный день (NFR-23, ARCHITECTURE §7): строка ISO «2026-10-21» с брендом. День считается по часовому поясу
// системы — это настройка (по умолчанию Минск), поэтому пояс всегда приходит аргументом. Intl в kernel — только
// в fromInstant: остальная логика дат от среды не зависит.
import { z } from "zod";

/** Часовой пояс IANA («Europe/Minsk»). */
export type TimeZone = string;

/** Пояс по умолчанию для настройки системы (NFR-23); код берёт пояс из настройки, а не отсюда. */
export const DEFAULT_TIME_ZONE: TimeZone = "Europe/Minsk";

// z.iso.date() проверяет и календарь: 2026-02-29 и 2026-13-01 не пройдут.
const schema = z.iso.date().brand<"LocalDate">();

/** Номер дня от 1970-01-01 по григорианскому календарю: целочисленная арифметика, без Date и часовых поясов. */
function toEpochDay(date: LocalDate): number {
  const [y = 0, m = 0, d = 0] = date.split("-").map(Number);
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function fromEpochDay(epochDay: number): LocalDate {
  const z = epochDay + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return LocalDate.parse(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

/**
 * Время суток «чч:мм» в часовом поясе `timeZone` в момент `instant` (NFR-23): подпись «10:42» в списке диалогов.
 * Неизвестный пояс — `RangeError` (Intl).
 */
export function timeOfDay(instant: Date, timeZone: TimeZone): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Недействительный момент времени.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: "hour" | "minute") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

/** Календарный день «ГГГГ-ММ-ДД» по часовому поясу системы. Строки сравниваются по порядку дат. */
export type LocalDate = z.infer<typeof schema>;

export const LocalDate = {
  schema,

  /** День из строки «ГГГГ-ММ-ДД»; иначе — `RangeError`. */
  parse(text: string): LocalDate {
    const result = schema.safeParse(text);
    if (!result.success) {
      throw new RangeError(`«${text}» — не календарный день в формате ГГГГ-ММ-ДД.`);
    }
    return result.data;
  },

  /** NFR-23: какой день в часовом поясе `timeZone` в момент `instant`. Неизвестный пояс — `RangeError` (Intl). */
  fromInstant(instant: Date, timeZone: TimeZone): LocalDate {
    if (Number.isNaN(instant.getTime())) throw new RangeError("Недействительный момент времени.");
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const part = (type: "year" | "month" | "day") =>
      parts.find((item) => item.type === type)?.value ?? "";
    return LocalDate.parse(`${part("year")}-${part("month")}-${part("day")}`);
  },

  /** День через `days` дней (отрицательное — назад); выход за 0001…9999 — `RangeError`. */
  addDays(date: LocalDate, days: number): LocalDate {
    if (!Number.isSafeInteger(days)) throw new RangeError("Число дней — целое.");
    return fromEpochDay(toEpochDay(date) + days);
  },

  /** Сколько дней от `from` до `to` (`to` позже — положительное). */
  daysBetween(from: LocalDate, to: LocalDate): number {
    return toEpochDay(to) - toEpochDay(from);
  },

  /** −1 — `a` раньше, 1 — позже, 0 — тот же день. */
  compare(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  },
} as const;
