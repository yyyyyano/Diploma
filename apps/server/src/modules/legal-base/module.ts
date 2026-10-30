// Модуль legal-base (паспорт — CLAUDE.md): каталог актов, вежливый загрузчик pravo.by, разбор на фрагменты, карантин и
// стартовый каталог (T-034). Поиск — T-035, ежедневное обновление — T-036, пополнение каталога — T-037. Источник текстов
// — порт LegalSource: pravo.by (PoliteFetcher) или сохранённые страницы (тесты и стенд e2e, настройка `legal-base.source`).
import { setTimeout as sleep } from "node:timers/promises";
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import { legalBaseRouter } from "./api/router.ts";
import { makeLoadAct } from "./application/load-act.ts";
import type { LegalSource } from "./application/ports.ts";
import { makeStartCatalog } from "./application/start-catalog.ts";
import { makeLoaderStore } from "./infrastructure/db/loader.repo.ts";
import { createFixturesSource } from "./infrastructure/pravo-by/fixtures-source.ts";
import { createPoliteFetcher } from "./infrastructure/pravo-by/polite-fetcher.ts";
import { createPravoSource } from "./infrastructure/pravo-by/pravo-source.ts";
import { loadStartCatalogJob } from "./jobs/load-start-catalog.job.ts";
import {
  LEGAL_BASE_SETTINGS,
  LEGAL_BASE_URL,
  LEGAL_FIXTURES_DIR,
  LEGAL_SOURCE,
  LOADER_CONTACT,
  LOADER_MAX_PAGE_BYTES,
  LOADER_PAUSE_MAX_MS,
  LOADER_PAUSE_MIN_MS,
  LOADER_TIMEOUT_MS,
} from "./settings.ts";
import { onSystemInitialized } from "./subscriptions/on-system-initialized.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LegalBaseFacades {
  readonly llm: LlmFacade;
  readonly notifications: NotificationsFacade;
  readonly identity: IdentityFacade;
}

export function createLegalBaseModule({
  platform,
  facades,
}: ModuleDeps<LegalBaseFacades, SystemPlatform>) {
  const store = makeLoaderStore(platform.system);
  const fetcher = createPoliteFetcher({
    fetch: (input, init) => fetch(input, init),
    clock: platform.clock,
    sleep: (ms, signal) => sleep(ms, undefined, signal === undefined ? {} : { signal }),
    random: () => Math.random(),
    contact: () => platform.settings.get(LOADER_CONTACT),
    settings: async () => ({
      pauseMinMs: await platform.settings.get(LOADER_PAUSE_MIN_MS),
      pauseMaxMs: await platform.settings.get(LOADER_PAUSE_MAX_MS),
      timeoutMs: await platform.settings.get(LOADER_TIMEOUT_MS),
      maxPageBytes: await platform.settings.get(LOADER_MAX_PAGE_BYTES),
    }),
    store,
    log: platform.log,
  });
  // NFR-11: тесты и стенд e2e берут сохранённые страницы, а не сеть; боевой источник — pravo.by через вежливый загрузчик.
  const source = async (): Promise<LegalSource> =>
    (await platform.settings.get(LEGAL_SOURCE)) === "fixtures"
      ? createFixturesSource({
          dir: () => platform.settings.get(LEGAL_FIXTURES_DIR),
          now: () => platform.clock.now(),
        })
      : createPravoSource({ fetcher, baseUrl: await platform.settings.get(LEGAL_BASE_URL) });
  const loadAct = makeLoadAct({
    system: platform.system,
    source,
    clock: platform.clock,
    log: platform.log,
    notifications: facades.notifications,
  });
  const catalog = makeStartCatalog({
    system: platform.system,
    loadAct,
    settings: platform.settings,
    clock: platform.clock,
    log: platform.log,
    notifications: facades.notifications,
    loader: store,
  });
  const job = loadStartCatalogJob(catalog);
  return defineModule({
    id: "legal-base",
    router: legalBaseRouter(catalog),
    jobs: [job],
    subscriptions: [onSystemInitialized(platform, { identity: facades.identity, catalog, job })],
    settings: LEGAL_BASE_SETTINGS,
  });
}

/** Что модуль даёт соседям: пока ничего (undefined); фасад появится с поиском (T-035). */
export type LegalBaseFacade = ReturnType<typeof createLegalBaseModule>["facade"];
