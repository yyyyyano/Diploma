// DES-17: время суток «08:47» — часы и минуты, 24 часа, без пояса и секунд. Время операции приходит с сервера уже
// «чч:мм» (в базе — «чч:мм:сс»); здесь — единственное место, которое его показывает: формат проверяется, а не
// собирается руками в компоненте.
import type { LocalDate } from "@kosht/kernel";
import { formatRelativeDay } from "./format-date.ts";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** «08:47» и «08:47:00» → «08:47»; не время суток — `RangeError`. */
export function formatTime(time: string): string {
  const match = TIME.exec(time);
  if (match === null) throw new RangeError(`Время суток — «чч:мм», получено «${time}».`);
  return `${match[1]}:${match[2]}`;
}

/**
 * Момент для ленты уведомлений и напоминаний (CAL-07): «сегодня, 09:00», «вчера, 18:40», «21.10.2026, 09:00» — день словами
 * или датой (как у `formatRelativeDay`) и время суток. День и время приходят готовыми по поясу системы (NFR-23):
 * `LocalDate.fromInstant` и `timeOfDay` из kernel.
 */
export function formatDayTime(day: LocalDate, time: string, today: LocalDate): string {
  return `${formatRelativeDay(day, today)}, ${formatTime(time)}`;
}
