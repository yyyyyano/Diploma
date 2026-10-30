// Настройки legal-base (ARCHITECTURE §9, LAW-35, LAW-36): автозагрузка, источник текстов, контакт оператора загрузчика,
// паузы и пределы вежливого загрузчика. Значение из админки важнее переменной окружения (NFR-16); поле «контакт» и
// остальное в админке — T-039.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";
import { DEFAULT_TITLE_PATTERNS } from "./domain/relevance.ts";
import { DEFAULT_EPK_TOPICS, TOPICS } from "./domain/topics.ts";

/**
 * Загружать ли правовую базу сама: по умолчанию да — после первого запуска (LAW-10). Тесты и стенд e2e выключают
 * (LEGAL_BASE_AUTOLOAD=0), как `llm.models-download`: интернета там нет (NFR-11).
 */
export const LEGAL_AUTOLOAD = defineSetting({
  key: "legal-base.autoload",
  schema: z.boolean(),
  default: true,
  env: "LEGAL_BASE_AUTOLOAD",
  fromEnv: (raw) => raw === "1" || raw === "true",
});

/** Откуда брать тексты: pravo.by или сохранённые страницы из папки `legal-base.fixtures-dir` (тесты, стенд e2e, NFR-11). */
export const LEGAL_SOURCE = defineSetting({
  key: "legal-base.source",
  schema: z.enum(["pravo-by", "fixtures"]),
  default: "pravo-by" as "pravo-by" | "fixtures",
  env: "LEGAL_SOURCE",
});

/** Папка сохранённых страниц для источника `fixtures`: `<ID>.html` на акт. */
export const LEGAL_FIXTURES_DIR = defineSetting({
  key: "legal-base.fixtures-dir",
  schema: z.string().max(1024),
  default: "",
  env: "LEGAL_FIXTURES_DIR",
});

/** Адрес сайта-источника (LAW-03: только pravo.by); меняется в тестах на локальный стенд. */
export const LEGAL_BASE_URL = defineSetting({
  key: "legal-base.base-url",
  schema: z.url({ protocol: /^https?$/ }).max(200),
  default: "https://pravo.by",
  env: "LEGAL_BASE_URL",
});

/**
 * Контакт оператора загрузчика (LAW-36): email или адрес сайта, попадает в User-Agent. Первый раз — с экрана первого
 * запуска (AUTH-10), дальше — админка (T-039). Пустой — загрузчик остановлен с понятным сообщением.
 */
export const LOADER_CONTACT = defineSetting({
  key: "legal-base.loader-contact",
  schema: z.string().max(254),
  default: "",
  env: "LEGAL_LOADER_CONTACT",
});

/** Пауза между запросами к pravo.by, мс: случайная между минимумом и максимумом (LAW-35: 3–5 с). */
export const LOADER_PAUSE_MIN_MS = defineSetting({
  key: "legal-base.pause-min-ms",
  schema: z.int().min(3000).max(60_000),
  default: 3000,
  env: "LEGAL_PAUSE_MIN_MS",
  fromEnv: Number,
});
export const LOADER_PAUSE_MAX_MS = defineSetting({
  key: "legal-base.pause-max-ms",
  schema: z.int().min(3000).max(120_000),
  default: 5000,
  env: "LEGAL_PAUSE_MAX_MS",
  fromEnv: Number,
});

/** Сколько ждать ответ pravo.by, мс. */
export const LOADER_TIMEOUT_MS = defineSetting({
  key: "legal-base.timeout-ms",
  schema: z.int().min(1000).max(300_000),
  default: 60_000,
  env: "LEGAL_TIMEOUT_MS",
  fromEnv: Number,
});

/** Предел размера страницы, байт: НК в сыром виде ≈ 1,1 МБ (ADR-0007); больше — страница не читается дальше. */
export const LOADER_MAX_PAGE_BYTES = defineSetting({
  key: "legal-base.max-page-bytes",
  schema: z.int().min(100_000).max(50_000_000),
  default: 4_000_000,
  env: "LEGAL_MAX_PAGE_BYTES",
  fromEnv: Number,
});

/** Сколько догрузок актов по требованию в сутки (LAW-09): дальше — карточка со ссылкой и уведомление администратору. */
export const DEMAND_LIMIT_PER_DAY = defineSetting({
  key: "legal-base.demand-limit-per-day",
  schema: z.int().min(0).max(1000),
  default: 20,
  env: "LEGAL_DEMAND_LIMIT_PER_DAY",
  fromEnv: Number,
});

/** Сколько `api` ждёт догрузку акта, мс (LAW-09): не дождался — отдаёт карточку со ссылкой. */
export const DEMAND_WAIT_MS = defineSetting({
  key: "legal-base.demand-wait-ms",
  schema: z.int().min(0).max(120_000),
  default: 15_000,
  env: "LEGAL_DEMAND_WAIT_MS",
  fromEnv: Number,
});

/** «Новые акты: добавлять автоматически / только предлагать» (LAW-12, LAW-17): «только предлагать» отправляет в очередь. */
export const NEW_ACTS_MODE = defineSetting({
  key: "legal-base.new-acts-mode",
  schema: z.enum(["auto", "suggest"]),
  default: "auto" as "auto" | "suggest",
});

/** Сколько кандидатов за один ночной проход проверяется с запросами к pravo.by (остальные — на следующую ночь, LAW-35). */
export const GROWTH_BATCH = defineSetting({
  key: "legal-base.growth-batch",
  schema: z.int().min(1).max(500),
  default: 60,
});

/** Сколько недель повторять проверку «появился ли текст» у новых актов без текста (LAW-13 п. 4, LAW-17). */
export const TEXT_CHECK_WEEKS = defineSetting({
  key: "legal-base.text-check-weeks",
  schema: z.int().min(0).max(52),
  default: 8,
});

/** Шаблоны заголовков для отсева кадровых, наградных, разовых и территориальных актов (LAW-13 п. 2; редактор — T-039). */
export const FILTER_TITLE_PATTERNS = defineSetting({
  key: "legal-base.filter-title-patterns",
  schema: z.array(z.string().max(300)).max(200),
  default: [...DEFAULT_TITLE_PATTERNS],
});

/** Таблица «рубрика ЕПК (префикс) → тема» (LAW-14; редактор — T-039). */
export const EPK_TOPICS = defineSetting({
  key: "legal-base.epk-topics",
  schema: z.record(z.string().max(20), z.enum(TOPICS)),
  default: { ...DEFAULT_EPK_TOPICS },
});

/**
 * Страницы ведомственных сайтов, с которых раз в месяц собираются ссылки на pravo.by (LAW-15). Адреса задаёт администратор
 * (T-039): страницы с нужными ссылками на живых сайтах не проверены, поэтому по умолчанию список пуст.
 */
export const AGENCY_PAGES = defineSetting({
  key: "legal-base.agency-pages",
  schema: z.array(z.url({ protocol: /^https?$/ }).max(300)).max(50),
  default: [] as string[],
});

export const LEGAL_BASE_SETTINGS = [
  NEW_ACTS_MODE,
  GROWTH_BATCH,
  TEXT_CHECK_WEEKS,
  FILTER_TITLE_PATTERNS,
  EPK_TOPICS,
  AGENCY_PAGES,
  DEMAND_LIMIT_PER_DAY,
  DEMAND_WAIT_MS,
  LEGAL_AUTOLOAD,
  LEGAL_SOURCE,
  LEGAL_FIXTURES_DIR,
  LEGAL_BASE_URL,
  LOADER_CONTACT,
  LOADER_PAUSE_MIN_MS,
  LOADER_PAUSE_MAX_MS,
  LOADER_TIMEOUT_MS,
  LOADER_MAX_PAGE_BYTES,
] as const;
