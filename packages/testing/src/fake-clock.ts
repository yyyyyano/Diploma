// Часы для тестов (.claude/rules/testing.md): момент задаёт тест, «сегодня» считается так же, как у настоящих
// часов platform/clock, — LocalDate.fromInstant по часовому поясу системы (NFR-23, по умолчанию Минск).
import { type Clock, DEFAULT_TIME_ZONE, LocalDate, type TimeZone } from "@kosht/kernel";

export class FakeClock implements Clock {
  readonly timeZone: TimeZone;
  #instant: number;

  /** `start` — момент ISO («2026-10-21T09:00:00Z») или Date; недействительный — `RangeError`. */
  constructor(start: Date | string, timeZone: TimeZone = DEFAULT_TIME_ZONE) {
    this.timeZone = timeZone;
    this.#instant = toMillis(start);
  }

  now(): Date {
    return new Date(this.#instant);
  }

  today(): LocalDate {
    return LocalDate.fromInstant(this.now(), this.timeZone);
  }

  /** Поставить часы на другой момент. */
  set(instant: Date | string): void {
    this.#instant = toMillis(instant);
  }

  /** Перевести часы вперёд на `ms` миллисекунд (назад — отрицательным числом). */
  advance(ms: number): void {
    this.#instant += ms;
  }
}

function toMillis(instant: Date | string): number {
  const millis = new Date(instant).getTime();
  if (Number.isNaN(millis))
    throw new RangeError(`Недействительный момент времени: «${String(instant)}».`);
  return millis;
}
