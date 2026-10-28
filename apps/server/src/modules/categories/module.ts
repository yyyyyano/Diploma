// Модуль categories (паспорт — CLAUDE.md): встроенные и свои категории (CAT-01, CAT-02), правила пользователя (CAT-05)
// и гибридная категоризация пакетами — правила → справочник → ключевые слова → MCC → модель (CAT-03, CAT-04, CAT-06).
import { createScopedCache } from "../../platform/cache/scoped-cache.ts";
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import { categoriesRouter } from "./api/router.ts";
import { makeCatalog } from "./application/catalog.ts";
import { makeCategorize } from "./application/categorize.ts";
import { MODEL_BATCH } from "./settings.ts";
import { categoriesUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface CategoriesFacades {
  readonly merchants: MerchantsFacade;
  readonly llm: LlmFacade;
}

/** LLM-05: одинаковые классификации контрагента — сутки из кэша процесса (ключ с домохозяйством). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5_000;

export function createCategoriesModule({
  platform,
  facades,
}: ModuleDeps<CategoriesFacades, SystemPlatform>) {
  const catalog = makeCatalog({ system: platform.system, platform });
  const categorize = makeCategorize({
    system: platform.system,
    merchants: facades.merchants,
    llm: facades.llm,
    settings: platform.settings,
    cache: createScopedCache<string>({
      max: CACHE_MAX,
      ttlMs: CACHE_TTL_MS,
      clock: platform.clock,
    }),
    log: platform.log,
  });
  return defineModule({
    id: "categories",
    facade: {
      byRules: categorize.byRules,
      withModel: categorize.withModel,
      categorize: categorize.categorize,
      list: catalog.list,
      setUserRule: catalog.setUserRule,
    },
    router: categoriesRouter(catalog),
    settings: [MODEL_BATCH],
    userData: categoriesUserData,
  });
}

/** Что модуль даёт соседям: категоризация (правила сразу, модель пакетом), список категорий, правило пользователя. */
export type CategoriesFacade = ReturnType<typeof createCategoriesModule>["facade"];
