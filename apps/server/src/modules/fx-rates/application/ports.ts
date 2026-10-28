// Внешний мир модуля fx-rates (ARCHITECTURE §4.4): источник курсов НБРБ. В тестах — фикстуры без сети.
import type { FxRate } from "../domain/fx-rate.ts";

export interface FxRatesSource {
  /** Курс на день; НБРБ курса на этот день не дал (пустой ответ, 404) — null. Сбой сети и таймаут — ошибка. */
  rateOn(currency: string, day: string): Promise<Omit<FxRate, "id"> | null>;
}
