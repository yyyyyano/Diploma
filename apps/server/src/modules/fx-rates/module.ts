// Модуль fx-rates (паспорт — CLAUDE.md): курсы НБРБ по ISO-коду с кэшем в fx_rates и эквивалент в BYN с курсом в
// трассе (STMT-09). Источник — адаптер НБРБ (порт FxRatesSource); вызывать — вне транзакций.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { FxRatesSource } from "./application/ports.ts";
import { makeRates } from "./application/rates.ts";
import { createNbrbSource } from "./infrastructure/nbrb.ts";
import { LOOKBACK_DAYS, NBRB_TIMEOUT_MS } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface FxRatesFacades {
  readonly explain: ExplainFacade;
}

export function createFxRatesModule(
  { platform }: ModuleDeps<FxRatesFacades, SystemPlatform>,
  source: FxRatesSource = createNbrbSource({
    timeoutMs: () => platform.settings.get(NBRB_TIMEOUT_MS),
  }),
) {
  const rates = makeRates({
    system: platform.system,
    source,
    clock: platform.clock,
    settings: platform.settings,
    log: platform.log,
  });
  return defineModule({
    id: "fx-rates",
    facade: { rateOn: rates.rateOn, convert: rates.convert },
    settings: [LOOKBACK_DAYS, NBRB_TIMEOUT_MS],
  });
}

/** Что модуль даёт соседям: курс на день и пересчёт суммы в BYN с курсом в трассе. */
export type FxRatesFacade = ReturnType<typeof createFxRatesModule>["facade"];
