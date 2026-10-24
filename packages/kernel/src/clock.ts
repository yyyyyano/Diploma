// Часы (NFR-23, ARCHITECTURE §4.4): «сейчас» и «сегодня» берутся только отсюда. Здесь — интерфейс: реализация по
// часовому поясу из настройки — platform/clock (T-005), в тестах — FakeClock из @kosht/testing. В calc часы не
// попадают: «сегодня» приходит туда аргументом.
import type { LocalDate } from "./local-date.ts";

export interface Clock {
  /** Текущий момент (UTC). */
  now(): Date;
  /** Текущий календарный день по часовому поясу системы. */
  today(): LocalDate;
}
