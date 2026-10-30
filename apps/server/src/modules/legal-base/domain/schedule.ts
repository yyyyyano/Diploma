// Время ежедневной проверки законов и ночное окно (LAW-30, LAW-35): «ЧЧ:ММ» по поясу системы. Чистые функции — настройки и cron
// собирает application. Проход пополнения каталога идёт через GROWTH_OFFSET_MIN после проверки: оба — плановые массовые проходы,
// оба обязаны лежать в окне.
import { z } from "zod";

/** «ЧЧ:ММ», 24-часовой формат: «04:00». */
export const ClockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

/** Через сколько минут после проверки идёт ночной проход пополнения каталога (было «30 4» при проверке в «0 4»). */
export const GROWTH_OFFSET_MIN = 30;

const DAY_MIN = 24 * 60;

/** Минуты от полуночи; вход — «ЧЧ:ММ», прошедшая `ClockTime`. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** cron «М Ч * * *» на время через `shiftMin` минут после `time` (за полночь — следующие сутки по кругу). */
export function dailyCron(time: string, shiftMin = 0): string {
  const total = (minutesOf(time) + shiftMin) % DAY_MIN;
  return `${total % 60} ${Math.floor(total / 60)} * * *`;
}

/** Попадает ли время в окно `from`–`to` включительно; окно может переходить через полночь («22:00»–«03:00»). */
export function inWindow(time: string, from: string, to: string): boolean {
  const t = minutesOf(time);
  const a = minutesOf(from);
  const b = minutesOf(to);
  return a <= b ? t >= a && t <= b : t >= a || t <= b;
}

export interface LawsScheduleInput {
  readonly checkTime: string;
  readonly windowFrom: string;
  readonly windowTo: string;
}

/**
 * Годится ли сочетание (LAW-35: время проверки — только внутри окна): окно не пустое, проверка и проход пополнения
 * каталога после неё лежат в окне. Иначе — код причины для ответа `VALIDATION`.
 */
export function checkSchedule(input: LawsScheduleInput): "window-empty" | "outside-window" | null {
  if (input.windowFrom === input.windowTo) return "window-empty";
  const growth = dailyCron(input.checkTime, GROWTH_OFFSET_MIN);
  const [m, h] = growth.split(" ").map(Number);
  const growthTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return inWindow(input.checkTime, input.windowFrom, input.windowTo) &&
    inWindow(growthTime, input.windowFrom, input.windowTo)
    ? null
    : "outside-window";
}
