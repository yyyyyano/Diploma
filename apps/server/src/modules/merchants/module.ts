// Модуль merchants (паспорт — CLAUDE.md): очистка названий контрагентов (STMT-06), справочник РБ с алиасами (CAT-03),
// похожесть названий (fuzzball + pg_trgm, TXN-10) и нормализация наименований позиций чека (RCPT-15).
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";
import { makeResolve } from "./application/resolve.ts";
import { cleanDescription } from "./domain/clean-name.ts";
import { ALIAS_SIMILARITY, NAME_SIMILARITY } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface MerchantsFacades {
  readonly llm: LlmFacade;
}

export function createMerchantsModule({ platform }: ModuleDeps<MerchantsFacades, SystemPlatform>) {
  const resolve = makeResolve({ system: platform.system, settings: platform.settings });
  return defineModule({
    id: "merchants",
    facade: {
      resolve: resolve.resolve,
      similarity: resolve.similarity,
      isSameMerchant: resolve.isSameMerchant,
      normalizeItemName: resolve.normalizeItemName,
      cleanDescription,
    },
    settings: [ALIAS_SIMILARITY, NAME_SIMILARITY],
  });
}

/** Что модуль даёт соседям: контрагенты по описаниям, похожесть названий, нормализация позиций. */
export type MerchantsFacade = ReturnType<typeof createMerchantsModule>["facade"];
