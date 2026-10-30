// Модуль legal-base (паспорт — CLAUDE.md): каталог актов, вежливый загрузчик pravo.by, разбор на фрагменты, карантин и
// стартовый каталог (T-034). Поиск — T-035, ежедневное обновление — T-036, пополнение каталога — T-037. Источник текстов
// — порт LegalSource: pravo.by (PoliteFetcher) или сохранённые страницы (тесты и стенд e2e, настройка `legal-base.source`).
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
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
import { makeDemand } from "./application/demand.ts";
import { makeLawSearch } from "./application/search.ts";
import { loadActJob } from "./jobs/load-act.job.ts";
import { makeLookup } from "./application/lookup.ts";
import { makeActCheck } from "./application/act-check.ts";
import { makeDailyCheck } from "./application/daily-check.ts";
import { makeSystemEvents } from "./application/system-events.ts";
import { ChangeProposal } from "./domain/change-proposal.ts";
import { actRepealed, actUpdated } from "./events.ts";
import { pendingChangesOf } from "./infrastructure/db/changes.repo.ts";
import { findAct } from "./infrastructure/db/catalog.repo.ts";
import { makeCatalogGrowth } from "./application/catalog-growth.ts";
import { TOPICS, type Topic } from "./domain/topics.ts";
import { catalogGrowthSchedule } from "./jobs/catalog-growth.schedule.ts";
import { dailyCheckSchedule } from "./jobs/daily-check.schedule.ts";
import { embedJob } from "./jobs/embed.job.ts";
import { makeLoadAct } from "./application/load-act.ts";
import type { DiscoverySource, LegalSource, RegistrySource } from "./application/ports.ts";
import { makeStartCatalog } from "./application/start-catalog.ts";
import { makeLoaderStore } from "./infrastructure/db/loader.repo.ts";
import { createFixturesSource } from "./infrastructure/pravo-by/fixtures-source.ts";
import {
  createPoliteFetcher,
  type PoliteFetcher,
} from "./infrastructure/pravo-by/polite-fetcher.ts";
import { createAgencySource, createPravoSource } from "./infrastructure/pravo-by/pravo-source.ts";
import { loadStartCatalogJob } from "./jobs/load-start-catalog.job.ts";
import {
  DEMAND_LIMIT_PER_DAY,
  DEMAND_WAIT_MS,
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

const TopicAnswer = z.object({ topic: z.enum([...TOPICS, "none"]) });
const TOPIC_INSTRUCTIONS =
  "Classify a Belarusian legal act by its title only. Answer with exactly one topic id: taxes; consumer (purchases and consumer rights); housing; banking (banks, loans, deposits, cards); work (employment, salary); benefits (state benefits, pensions, privileges, family capital); contracts (contracts, insurance, transport); education-health (paid education and medicine); family (alimony, inheritance); fines (administrative fines). Answer none if the act is not about money or property rights of citizens. Use only the title.";

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
  // Вежливый загрузчик на каждый сайт: у pravo.by и у каждого ведомственного хоста (LAW-15) своя пауза, robots и остановка цикла.
  const fetchers = new Map<string, PoliteFetcher>();
  const fetcherFor = (host: string): PoliteFetcher => {
    const known = fetchers.get(host);
    if (known !== undefined) return known;
    const made = createPoliteFetcher({
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
      store: host === "pravo.by" ? store : makeLoaderStore(platform.system, host),
      log: platform.log,
    });
    fetchers.set(host, made);
    return made;
  };
  const fetcher = fetcherFor("pravo.by");
  // NFR-11: тесты и стенд e2e берут сохранённые страницы, а не сеть; боевой источник — pravo.by через вежливый загрузчик.
  const source = async (): Promise<LegalSource & RegistrySource & DiscoverySource> =>
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
  // LAW-09: догрузка по требованию — задача с приоритетом, api на pravo.by сам не ходит.
  const loadOne = loadActJob(loadAct, (s) =>
    s.transaction((tx) => platform.jobs.enqueue(tx, embed, {})),
  );
  const demand = makeDemand({
    system: platform.system,
    enqueue: (s, pravoId) => s.transaction((tx) => platform.jobs.enqueue(tx, loadOne, { pravoId })),
    limitPerDay: () => platform.settings.get(DEMAND_LIMIT_PER_DAY),
    waitMs: () => platform.settings.get(DEMAND_WAIT_MS),
    clock: platform.clock,
    log: platform.log,
    notifications: facades.notifications,
  });
  const search = makeLawSearch({
    system: platform.system,
    demand,
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
  // LAW-14, LAW-17: модель определяет тему только спорных актов, по одному заголовку (данных пользователя нет, PRIV-09).
  const growth = makeCatalogGrowth({
    system: platform.system,
    source,
    agencies: createAgencySource({ fetcherFor }),
    loadAct,
    actCheck,
    classify: async (title): Promise<Topic | null> => {
      const answer = await facades.llm.extract(caller, {
        task: "law.topic",
        schema: TopicAnswer,
        instructions: TOPIC_INSTRUCTIONS,
        document: title,
        promptVersion: "law-topic-v1",
      });
      return answer.topic === "none" ? null : answer.topic;
    },
    embedder,
    settings: platform.settings,
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
      /** Поиск по законам: точное обращение (с догрузкой акта по требованию, если передан `s`) или гибрид, 6–10 фрагментов (LAW-21). */
      search: search.search,
      /** Фрагмент действующей версии по id (цитата, CHAT-10). */
      fragment: lookup.fragment,
      /** Карточка акта по ID pravo.by. */
      actCard: lookup.actCard,
      /** Прогресс векторного индекса для админки (T-039): `modelReady` — ответил ли самотест модели. */
      vectorProgress: embedder.progress,
      /** Принятые, но не вступившие изменения акта (LAW-32): статьи — проверенные дословно, пусто — предупреждение на уровне акта. */
      /** Журнал спроса (LAW-15): тема вопроса, на который база ответила «в моей базе нет», и ID подходящих актов; текста вопроса нет. */
      recordDemand: growth.recordDemand,
      pendingChanges: async (pravoId: string) => {
        const act = await findAct(platform.system, pravoId);
        return act === undefined ? [] : pendingChangesOf(platform.system, act.id);
      },
    },
    router: legalBaseRouter(catalog),
    tools: Object.values(tools),
    events: [actUpdated, actRepealed],
    jobs: [job, embed, loadOne],
    schedules: [dailyCheckSchedule(dailyCheck), catalogGrowthSchedule(growth)],
    subscriptions: [onSystemInitialized(platform, { identity: facades.identity, catalog, job })],
    settings: LEGAL_BASE_SETTINGS,
  });
}

/** Что модуль даёт соседям: поиск по законам, фрагмент, карточка акта, прогресс векторов. */
export type LegalBaseFacade = ReturnType<typeof createLegalBaseModule>["facade"];
