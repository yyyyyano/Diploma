// Догон расписаний (NFR-22, ADR-0008): pg-boss с missed: "once" после простоя присылает один запуск, но не говорит,
// сколько периодов пропущено. Это говорит водяной знак — последний обработанный день: запуск обрабатывает все
// закончившиеся периоды после него. Чистая функция над календарными днями (пояс уже учтён в Clock.today()).
import { LocalDate, Period } from "@kosht/kernel";

const DAY_MS = 86_400_000;

function addDays(day: LocalDate, days: number): LocalDate {
  const midnight = Date.parse(`${day}T00:00:00Z`) + days * DAY_MS;
  return LocalDate.parse(new Date(midnight).toISOString().slice(0, 10));
}

/**
 * Закончившиеся периоды по `step` дней после водяного знака `watermark` (сам он обработан), по порядку; период,
 * в который входит `today`, ещё не закончился и не входит. Водяного знака нет (первый запуск) — только последний
 * закончившийся период: история до установки не догоняется.
 */
export function pendingPeriods(
  watermark: LocalDate | undefined,
  today: LocalDate,
  step: number,
): Period[] {
  if (!Number.isInteger(step) || step < 1) {
    throw new RangeError(`Шаг периода — целое число дней ≥ 1, получено ${String(step)}.`);
  }
  const yesterday = addDays(today, -1);
  if (watermark === undefined) return [Period.of(addDays(today, -step), yesterday)];
  const periods: Period[] = [];
  for (let from = addDays(watermark, 1); ; from = addDays(from, step)) {
    const to = addDays(from, step - 1);
    if (LocalDate.compare(to, yesterday) > 0) return periods;
    periods.push(Period.of(from, to));
  }
}
