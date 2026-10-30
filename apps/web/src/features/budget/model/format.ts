// Подписи экрана «Лимиты и цели»: месяц словами. Только текст — деньги сервер уже посчитал (P1).
import type { TFunction } from "i18next";

export type T = TFunction<"budget">;

/** «2026-10» → «октябрь»; с заглавной — для заголовка страницы. */
export function monthWord(t: T, month: string, capital = false): string {
  const [, number = "01"] = month.split("-");
  const word = t(`months.${number as "01"}`);
  return capital ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word;
}
