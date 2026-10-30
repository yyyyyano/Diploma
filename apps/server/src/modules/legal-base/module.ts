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
import { systemCaller, type LlmFacade } from "../llm/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import { legalBaseTools } from "./agent/tools.ts";
import { legalBaseRouter } from "./api/router.ts";
import { makeEmbedder } from "./application/embed.ts";
import { makeLawSearch } from "./application/search.ts";
import { makeLookup } from "./application/lookup.ts";
import { makeActCheck } from "./application/act-check.ts";
import { makeDailyCheck } from "./application/daily-check.ts";
import { makeSystemEvents } from "./application/system-events.ts";
import { ChangeProposal } from "./domain/change-proposal.ts";
import { actRepealed, actUpdated } from "./events.ts";
import { pendingChangesOf } from "./infrastructure/db/changes.repo.ts";
import { findAct } from "./infrastructure/db/catalog.repo.ts";
import { dailyCheckSchedule } from "./jobs/daily-check.schedule.ts";
import { embedJob } from "./jobs/embed.job.ts";
import { makeLoadAct } from "./application/load-act.ts";
import type { LegalSource, RegistrySource } from "./application/ports.ts";
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
  const source = async (): Promise<LegalSource & RegistrySource> =>
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
  // Векторы (LAW-22, LAW-23): локальная модель цепочки `embed` через шлюз llm; нет модели — поиск без векторов, задача ждёт.
  const caller = systemCaller("legal-base");
  const embedder = makeEmbedder({
    system: platform.system,
    embed: (texts) => facades.llm.embed(caller, texts),
    clock: platform.clock,
    log: platform.log,
  });
  const embed = embedJob(embedder);
  const search = makeLawSearch({
    system: platform.system,
    embedQuery: async (text) => (await facades.llm.embed(caller, [text]))[0] ?? null,
    log: platform.log,
  });
  // События общей базы — без своего владельца: от имени первого администратора, как identity.system-initialized.
  const publish = makeSystemEvents({
    adminScoped: () => facades.identity.adminScoped(),
    events: { publish: (tx, event, payload) => platform.events.publish(tx, event, payload) },
  });
  const actCheck = makeActCheck({
    system: platform.system,
    source,
    loadAct,
    publish,
    // LAW-32: модель (systemCaller, данных пользователя нет) лишь предлагает статьи и дату; принимает программа (verifyProposal).
    proposeChange: (document) =>
      facades.llm.extract(caller, {
        task: "law.topic",
        schema: ChangeProposal,
        instructions:
          "The document is a Belarusian amending act. List the article numbers of the amended act that it changes (e.g. '209', '216.1') and the date it enters into force as ISO yyyy-mm-dd, or null. Use only what the text says.",
        document,
        promptVersion: "law-change-v1",
      }),
    clock: platform.clock,
    log: platform.log,
    notifications: facades.notifications,
  });
  const dailyCheck = makeDailyCheck({
    system: platform.system,
    check: actCheck,
    embedder,
    clock: platform.clock,
    log: platform.log,
    notifications: facades.notifications,
  });
  const job = loadStartCatalogJob(catalog, (s) =>
    s.transaction((tx) => platform.jobs.enqueue(tx, embed, {})),
  );
  const lookup = makeLookup({ system: platform.system });
  const tools = legalBaseTools({ search, lookup });
  return defineModule({
    id: "legal-base",
    facade: {
      /** Поиск по законам: точное обращение или гибрид, 6–10 действующих фрагментов (LAW-21). */
      search: search.search,
      /** Фрагмент действующей версии по id (цитата, CHAT-10). */
      fragment: lookup.fragment,
      /** Карточка акта по ID pravo.by. */
      actCard: lookup.actCard,
      /** Прогресс векторного индекса для админки (T-039): `modelReady` — ответил ли самотест модели. */
      vectorProgress: embedder.progress,
      /** Принятые, но не вступившие изменения акта (LAW-32): статьи — проверенные дословно, пусто — предупреждение на уровне акта. */
      pendingChanges: async (pravoId: string) => {
        const act = await findAct(platform.system, pravoId);
        return act === undefined ? [] : pendingChangesOf(platform.system, act.id);
      },
    },
    router: legalBaseRouter(catalog),
    tools: Object.values(tools),
    events: [actUpdated, actRepealed],
    jobs: [job, embed],
    schedules: [dailyCheckSchedule(dailyCheck)],
    subscriptions: [onSystemInitialized(platform, { identity: facades.identity, catalog, job })],
    settings: LEGAL_BASE_SETTINGS,
  });
}

/** Что модуль даёт соседям: поиск по законам, фрагмент, карточка акта, прогресс векторов. */
export type LegalBaseFacade = ReturnType<typeof createLegalBaseModule>["facade"];
