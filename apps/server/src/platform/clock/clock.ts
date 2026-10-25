// Часы системы (NFR-23, ARCHITECTURE §4.4): «сейчас» и «сегодня» в коде берутся только отсюда. «Сегодня» — по
// часовому поясу из настройки (по умолчанию Минск). Часы не знают о platform/settings: пояс подаёт функция
// timeZone(), её подставляет корень композиции (main/compose.ts) из настройки, а settings берёт часы без пояса —
// так между ними нет цикла. Неверный пояс отвергается при записи настройки и при её чтении (TimeZoneSchema).
import { DEFAULT_TIME_ZONE, LocalDate, type Clock, type TimeZone } from "@kosht/kernel";
import { z } from "zod";

/** Пояс IANA, который понимает Intl этой сборки Node («Europe/Minsk», «UTC»). */
export function isTimeZone(value: string): boolean {
  if (value.trim() === "" || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch (error) {
    // Intl сообщает о неизвестном поясе только RangeError; другое — не про пояс, пусть летит дальше.
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/** Схема настройки «часовой пояс» (ADM-60): неверный — ошибка с подсказкой. */
export const TimeZoneSchema = z
  .string()
  .max(64)
  .refine(isTimeZone, { error: "ожидается часовой пояс IANA, например Europe/Minsk" });

/** Часы по поясу из timeZone(); без неё — Минск (NFR-23). */
export function createClock(timeZone: () => TimeZone = () => DEFAULT_TIME_ZONE): Clock {
  return {
    now: () => new Date(),
    today: () => LocalDate.fromInstant(new Date(), timeZone()),
  };
}
