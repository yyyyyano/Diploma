// Курсы НБРБ с кэшем (STMT-09): курс на день — из кэша fx_rates, иначе из НБРБ; на день курса нет (выходной) — шаг
// назад, до LOOKBACK_DAYS дней: последний установленный. На сегодня «вчерашний» курс кэшируется только на свой день
// (НБРБ ещё может установить сегодняшний); прошедшие дни кэшируются навсегда. BYN не запрашивается. Сеть — только здесь и только вне
// транзакций (вызывающий зовёт фасад до s.transaction). Сбой НБРБ — курса нет (undefined): итог в BYN не показывается.
import { toByn, type Calc } from "@kosht/calc";
import type { Clock, LocalDate, Money } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import { previousDay, type FxRate } from "../domain/fx-rate.ts";
import { findCachedRate, saveRate } from "../infrastructure/db/fx-rates.repo.ts";
import { LOOKBACK_DAYS } from "../settings.ts";
import type { FxRatesSource } from "./ports.ts";

export interface RatesDeps {
  readonly system: SystemDb;
  readonly source: FxRatesSource;
  readonly clock: Pick<Clock, "now" | "today">;
  readonly settings: Pick<Settings, "get">;
  readonly log: Logger;
}

export function makeRates(d: RatesDeps) {
  /** Курс валюты на день (последний установленный на эту дату); нет или НБРБ недоступен — undefined. */
  async function rateOn(currency: string, day: LocalDate): Promise<FxRate | undefined> {
    if (currency === "BYN") throw new RangeError("Курс BYN к BYN не запрашивается.");
    const cached = await findCachedRate(d.system, currency, day);
    if (cached !== undefined) return cached;
    const lookback = await d.settings.get(LOOKBACK_DAYS);
    let probe: string = day;
    try {
      for (let step = 0; step <= lookback; step += 1) {
        const found = await d.source.rateOn(currency, probe);
        if (found !== null) {
          // На сегодня НБРБ ещё может установить курс: «вчерашний» запоминается на свой день, а не на сегодня.
          const cacheDay = found.rateDate !== day && day >= d.clock.today() ? found.rateDate : day;
          return await saveRate(d.system, cacheDay, found, d.clock.now());
        }
        probe = previousDay(probe);
      }
      d.log.warn({ reason: "no-rate", code: currency }, "fx.rate-missing");
    } catch (error) {
      d.log.warn({ err: error, code: currency }, "fx.rate-unavailable");
    }
    return undefined;
  }

  /** STMT-09: сумма в BYN по курсу на день с курсом в трассе; BYN — как есть; курса нет — undefined. */
  async function convert(
    key: string,
    amount: Calc<Money>,
    day: LocalDate,
  ): Promise<{ calc: Calc<Money>; rate: FxRate | null } | undefined> {
    if (amount.value.currency === "BYN") return { calc: amount, rate: null };
    const rate = await rateOn(amount.value.currency, day);
    if (rate === undefined) return undefined;
    return { calc: toByn(key, amount, rate), rate };
  }

  return { rateOn, convert };
}

export type Rates = ReturnType<typeof makeRates>;
