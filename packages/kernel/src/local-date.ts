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

  /** −1 — `a` раньше, 1 — позже, 0 — тот же день. */
  compare(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  },
} as const;
