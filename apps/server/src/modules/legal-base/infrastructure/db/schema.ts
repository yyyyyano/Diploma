// Таблицы legal-base (LAW-07, LAW-20, LAW-31, LAW-35…39, ADR-0007, ARCHITECTURE §6.1). Каталог актов, снимки и
// фрагменты — publicTable: правовая база общая для всех, читает её и гость («База законов»), пишет только legal-base
// через SystemDb. Состояние загрузчика, кэш robots.txt и журнал запросов — systemTable (читает админка, T-039).
// Векторы, полнотекстовый индекс и словари — T-035; очереди принятых изменений — T-036; кандидаты — T-037.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  halfvec,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { publicTable, systemTable } from "../../../../platform/db/tables.ts";

const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);
const moment = () => timestamp({ withTimezone: true });

/** Сырой HTML снимка в gzip (ADR-0007): Buffer туда и обратно. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** tsvector: колонка, которую считает база (генерируемая), в приложении читается только через SQL поиска. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Состояние загрузки акта: ждёт, загружен, только карточка, карантин (LAW-39), ошибка. */
export const ACT_LOAD_STATES = ["pending", "loaded", "card-only", "quarantined", "failed"] as const;
export type ActLoadState = (typeof ACT_LOAD_STATES)[number];

/** Откуда акт попал в каталог (LAW-07). */
export const ACT_SOURCES = [
  "start-catalog",
  "link-graph",
  "new-arrivals",
  "admin",
  "demand",
] as const;
export type ActSource = (typeof ACT_SOURCES)[number];

/** Каталог актов: одна строка на акт pravo.by (LAW-07). */
export const legalActs = publicTable(
  "legal_acts",
  {
    id: id(),
    /** ID на pravo.by (параметр p0): `H10200090`. */
    pravoId: text().notNull(),
    title: text().notNull(),
    /** Вид по ID и тексту каталога: закон, кодекс, указ, постановление Совмина, разъяснение Пленума (LAW-04). */
    kind: text().notNull(),
    /** Разъяснение Пленума — не НПА (LAW-04): отдельный признак для читалки и ответов. */
    isNpa: boolean().notNull().default(true),
    /** Есть ли текст на pravo.by: акты без текста хранятся карточкой (LEGAL-06). */
    hasText: boolean().notNull(),
    status: text().notNull().default("active"),
    source: text().notNull(),
    loadState: text().notNull().default("pending"),
    /** Последний применённый снимок — «действующая редакция» (LAW-39: остаётся при карантине). */
    currentSnapshotId: uuid(),
    /** Сколько статей у акта по последнему применённому снимку (канарейка LAW-39). */
    articleCount: integer(),
    loadedAt: moment(),
    /** День, с которого акт утратил силу (LAW-34): «Дата ограничения действия» с карточки; пусто — действует. */
    repealedOn: date({ mode: "string" }),
    /** Когда карточку акта читали в последний раз (LAW-30: карточки индекса — ежедневно, прочих — раз в неделю). */
    cardCheckedAt: moment(),
    /** Код причины последней ошибки или карантина (без текста страницы, OBS-04). */
    lastProblem: text(),
    createdAt: moment().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("legal_acts_pravo_id_idx").on(t.pravoId),
    index("legal_acts_source_state_idx").on(t.source, t.loadState),
    check(
      "legal_acts_load_state_check",
      sql`${t.loadState} in ('pending','loaded','card-only','quarantined','failed')`,
    ),
    check("legal_acts_status_check", sql`${t.status} in ('active','repealed')`),
  ],
);

/**
 * Снимок страницы акта: сырой HTML (gzip) хранится только при смене хэша текста (ADR-0007). Статус: applied — разобран
 * и применён; quarantined — не применён (LAW-39); pending — страница изменилась, версии фрагментов сопоставит T-036.
 */
export const legalActSnapshots = publicTable(
  "legal_act_snapshots",
  {
    id: id(),
    actId: uuid()
      .notNull()
      .references(() => legalActs.id),
    textHash: text().notNull(),
    rawGz: bytea("raw_gz").notNull(),
    rawBytes: integer().notNull(),
    status: text().notNull(),
    reason: text(),
    fetchedAt: moment().notNull(),
  },
  (t) => [
    index("legal_act_snapshots_act_idx").on(t.actId, t.fetchedAt),
    uniqueIndex("legal_act_snapshots_hash_idx").on(t.actId, t.textHash),
    check(
      "legal_act_snapshots_status_check",
      sql`${t.status} in ('applied','quarantined','pending')`,
    ),
  ],
);

/** Фрагмент — цитируемая единица акта; ключ `pathKey` стабилен между редакциями (LAW-31). */
export const legalFragments = publicTable(
  "legal_fragments",
  {
    id: id(),
    actId: uuid()
      .notNull()
      .references(() => legalActs.id),
    /** Ключ пути: `a216.1/p3/s2` — статья 216¹, пункт 3, подпункт 2; у указов — `p3/s2`. */
    pathKey: text().notNull(),
    /** Номер статьи (ключ `216.1`, ADR-0007) — для точного обращения «ст. 210 НК»; у указов пуст. */
    articleNo: text(),
    position: integer().notNull(),
    createdAt: moment().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("legal_fragments_act_path_idx").on(t.actId, t.pathKey),
    index("legal_fragments_article_idx").on(t.actId, t.articleNo),
  ],
);

/** Версия фрагмента (LAW-31): текст, путь для поиска, вид, статус; `is_current` — действующая. */
export const legalFragmentVersions = publicTable(
  "legal_fragment_versions",
  {
    id: id(),
    fragmentId: uuid()
      .notNull()
      .references(() => legalFragments.id),
    kind: text().notNull(),
    /** «НК (Особенная часть) › Глава 16 › Статья 209 › п. 1»: приписывается к тексту для поиска, не к цитате. */
    searchPath: text().notNull(),
    heading: text(),
    /** Чистый текст без пути: дословность цитат проверяется по нему (LAW-20). */
    body: text().notNull(),
    textHash: text().notNull(),
    /** Исключённая статья хранится, чтобы честно отвечать «ст. N исключена» (LAW-20). */
    excluded: boolean().notNull().default(false),
    isCurrent: boolean().notNull().default(true),
    /** Полнотекстовый вектор `russian`, ё → е (ADR-0007): путь и текст; считает база, поиск сразу после разбора (LAW-22). */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('russian', translate(lower(search_path || ' ' || body), 'ё', 'е'))`,
    ),
    firstSnapshotId: uuid()
      .notNull()
      .references(() => legalActSnapshots.id),
    lastSnapshotId: uuid()
      .notNull()
      .references(() => legalActSnapshots.id),
  },
  (t) => [
    index("legal_fragment_versions_fragment_idx").on(t.fragmentId, t.isCurrent),
    uniqueIndex("legal_fragment_versions_current_idx")
      .on(t.fragmentId)
      .where(sql`${t.isCurrent}`),
  ],
);

/**
 * Состояние загрузчика (LAW-35…38): одна строка id = 1. Время последнего запроса переживает перезапуск (пауза 3–5 с),
 * остановка цикла — до `stoppedUntil`, кэш robots.txt — раз в сутки. Контакт оператора (LAW-36) — настройкой
 * `legal-base.loader-contact`, здесь его нет: в логи и журналы он не попадает (OBS-04).
 */
export const legalLoaderState = systemTable(
  "legal_loader_state",
  {
    id: integer().primaryKey(),
    lastRequestAt: moment(),
    /** Следующий запрос — не раньше этого момента: пауза выбирается случайно в 3–5 с при каждом запросе. */
    nextRequestAt: moment(),
    /** День остановки цикла (403/429, много ошибок): до следующих суток по поясу системы запросов нет (LAW-38). */
    stoppedOn: date({ mode: "string" }),
    /** Код причины остановки: LOADER_BLOCKED, LOADER_TOO_MANY_ERRORS (пустой контакт — не состояние, а проверка). */
    stopReason: text(),
    robotsTxt: text(),
    robotsFetchedAt: moment(),
    /** День, к которому относятся счётчики цикла: в новый день они обнуляются. */
    cycleDay: date({ mode: "string" }),
    cycleRequests: integer().notNull().default(0),
    cycleErrors: integer().notNull().default(0),
  },
  (t) => [check("legal_loader_state_singleton_check", sql`${t.id} = 1`)],
);

/** Журнал запросов загрузчика (LAW-40): адрес без параметров поиска, код ответа, размер, время. */
export const legalFetchLog = systemTable(
  "legal_fetch_log",
  {
    id: id(),
    at: moment().notNull(),
    url: text().notNull(),
    httpStatus: integer(),
    bytes: integer(),
    ms: integer(),
    /** Код исхода без текста: ok, robots-denied, timeout, network, http-5xx… */
    outcome: text().notNull(),
  },
  (t) => [index("legal_fetch_log_at_idx").on(t.at)],
);

/**
 * Журнал обновлений (LAW-40): загрузка акта, карантин (LAW-39), остановка цикла. Событие — код, подробности — числа и
 * коды без текста страниц (OBS-04); показывает журнал админка (T-039), дополняет T-036.
 */
export const legalUpdateLog = systemTable(
  "legal_update_log",
  {
    id: id(),
    at: moment().notNull(),
    actId: uuid().references(() => legalActs.id),
    event: text().notNull(),
    details: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index("legal_update_log_at_idx").on(t.at)],
);

/** Краткие имена актов для точного обращения «ст. 210 НК» (LAW-21): нормализованный алиас → акт; редактор — T-039. */
export const legalActAliases = publicTable(
  "legal_act_aliases",
  {
    id: id(),
    actId: uuid()
      .notNull()
      .references(() => legalActs.id),
    /** Нижний регистр, ё → е, одиночные пробелы: «закона о защите прав потребителей». */
    alias: text().notNull(),
  },
  (t) => [uniqueIndex("legal_act_aliases_alias_idx").on(t.alias, t.actId)],
);

/** Модель эмбеддингов: имя и версия при каждом векторе (LAW-23); смена модели — фоновая переиндексация. */
export const legalEmbeddingModels = publicTable("legal_embedding_models", {
  id: id(),
  name: text().notNull(),
  version: text().notNull(),
  dimensions: integer().notNull(),
  /** Активная модель одна: по ней строятся запросы и индекс. */
  active: boolean().notNull().default(false),
  createdAt: moment().notNull().defaultNow(),
});

/** Вектор текущей версии фрагмента (ADR-0007: halfvec, косинус); у неактуальных версий векторов нет. */
export const legalFragmentEmbeddings = publicTable(
  "legal_fragment_embeddings",
  {
    versionId: uuid()
      .primaryKey()
      .references(() => legalFragmentVersions.id),
    modelId: uuid()
      .notNull()
      .references(() => legalEmbeddingModels.id),
    embedding: halfvec({ dimensions: 1024 }).notNull(),
    embeddedAt: moment().notNull(),
  },
  (t) => [index("legal_fragment_embeddings_model_idx").on(t.modelId)],
);

/**
 * Принятые, но не вступившие (не отражённые в тексте) изменения акта (LAW-32): строка на изменяющий акт. Ключ — «номер|дата»
 * из карточки; когда изменяющий акт появился в перечне текста — `reflected`. Статьи — только проверенные дословно по тексту
 * изменяющего акта (модель предлагает, программа проверяет); пусто — предупреждение на уровне акта.
 */
export const legalPendingChanges = publicTable(
  "legal_pending_changes",
  {
    id: id(),
    actId: uuid()
      .notNull()
      .references(() => legalActs.id),
    changeKey: text().notNull(),
    /** «Закон Республики Беларусь от 16 марта 2026 г. № 134-З» — как в карточке. */
    description: text().notNull(),
    inForceOn: date({ mode: "string" }),
    articles: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text().notNull().default("pending"),
    firstSeenAt: moment().notNull(),
    /** Когда изменяющий акт разобран (статьи и дата вступления); пусто — ещё не разбирали. */
    analyzedAt: moment(),
    notifiedAt: moment(),
  },
  (t) => [
    uniqueIndex("legal_pending_changes_key_idx").on(t.actId, t.changeKey),
    check("legal_pending_changes_status_check", sql`${t.status} in ('pending','reflected')`),
  ],
);

/** Догрузки по требованию (LAW-09): строка на догрузку — предел в сутки считается по ним. */
export const legalDemandLoads = publicTable(
  "legal_demand_loads",
  {
    id: id(),
    actId: uuid()
      .notNull()
      .references(() => legalActs.id),
    at: moment().notNull(),
  },
  (t) => [index("legal_demand_loads_at_idx").on(t.at)],
);
