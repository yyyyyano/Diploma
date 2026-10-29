// Правила границ dependency-cruiser, собранные из карты модулей (ADR-0002, ADR-0003, ADR-0014,
// docs/ARCHITECTURE.md §2, §4.2, §6.2, §10.1, CONSTRAINTS.md «Архитектурные запреты»). Закоммиченной копии
// правил нет: .dependency-cruiser.mjs вызывает buildConfig() при каждой загрузке.
// Новое правило ⇒ фикстура нарушения в tooling/architecture/fixtures/rules/<имя>/ и тест «правило ловит своё»
// (rules.fixtures.test.ts). Правило, которое ничего не ловит, — сломанное правило (ARCHITECTURE §15).
import type { ICruiseOptions, IRegularForbiddenRuleType } from "dependency-cruiser";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MODULES, systemTables, type ModuleDef } from "./modules.ts";

/** Корни обхода; проверяются только существующие (deps-guard.mjs). */
export const ROOTS = ["apps", "packages", "e2e", "tooling"] as const;

/** Фикстуры нарушений: одно общее исключение для tsc, oxlint, oxfmt, vitest и deps-check (и T-056). */
export const FIXTURES_DIR = "tooling/architecture/fixtures";

const SERVER = "apps/server/src";
const MOD = `${SERVER}/modules`;
const PLATFORM = `${SERVER}/platform`;
const WEB = "apps/web/src";

/**
 * Возможности доступа к БД (ARCHITECTURE §6.5): отдельные файлы platform/db, общего index.ts нет.
 * Каждый путь — файл `<путь>.ts` или папка `<путь>/`.
 */
export const PLATFORM_DB = {
  unsafe: `${PLATFORM}/db/unsafe-raw`,
  crossTenant: `${PLATFORM}/db/cross-tenant`,
  system: `${PLATFORM}/db/system-db`,
  boss: `${PLATFORM}/db/boss-db`,
} as const;

/**
 * Внутренности platform/db, которые модулям не выдаются (ADR-0006): аудитор и Drizzle с произвольным режимом
 * аудита (`auditedDrizzle(pool, { kind: "scoped", householdId })` подставил бы любое домохозяйство), пул и
 * миграции. Пул и миграции нужны ещё корню композиции (main/, T-007).
 */
export const PLATFORM_DB_INTERNALS = {
  audit: `${PLATFORM}/db/audit`,
  audited: `${PLATFORM}/db/audited`,
  connection: `${PLATFORM}/db/connection`,
  migrate: `${PLATFORM}/db/migrate`,
} as const;

/**
 * Пути PLATFORM_DB, которых нет на диске, хотя папка platform/db уже есть. Правила no-unsafe-db,
 * cross-tenant-only-in-sweeps и system-db-only-for-flagged-modules смотрят только на эти пути: файл, названный
 * иначе, или общий platform/db/index.ts выключили бы их молча (ARCHITECTURE §15). Пока папки нет — пусто.
 */
export function missingPlatformDbPaths(baseDir: string): string[] {
  if (!existsSync(join(baseDir, PLATFORM, "db"))) return [];
  return Object.values(PLATFORM_DB).filter(
    (path) => !existsSync(join(baseDir, `${path}.ts`)) && !existsSync(join(baseDir, path)),
  );
}

/** Тестовый код: тесты рядом с файлами, фикстуры, кассеты, @kosht/testing, e2e, настройка тестов сайта. */
const TEST_CODE = [
  String.raw`\.(test|spec)\.tsx?$`,
  // Замеры времени (make bench, CONSTRAINTS «Бюджеты времени») — тоже тестовый код.
  String.raw`\.bench\.ts$`,
  "/__fixtures__/",
  "/__cassettes__/",
  "^packages/testing/",
  "^e2e/",
  `^${WEB}/test/`,
];

const SCHEMA = `${MOD}/[^/]+/infrastructure/db/schema(\\.ts$|/)`;
/**
 * Схемы и репозитории платформы со своими системными таблицами (ARCHITECTURE §6.1, решения по T-005 и T-006):
 * settings, secrets, rate_limits, background_job_run. Им нужен drizzle-orm, хотя они не в platform/db; остальной
 * платформе (и прочим файлам jobs/) — нет.
 */
const PLATFORM_TABLES = `^${PLATFORM}/(settings|secrets|rate-limit|jobs)/(schema|[^/]+\\.repo)\\.ts$`;
const PLATFORM_SCHEMA = `^${PLATFORM}/[^/]+/schema\\.ts$`;
const REPO = `${MOD}/[^/]+/infrastructure/db/[^/]+\\.(repo|sql)\\.ts$`;

/** Запрет dependency-cruiser с обязательными именем, пояснением и уровнем «ошибка». */
export type ForbiddenRule = IRegularForbiddenRuleType & {
  name: string;
  severity: "error";
  comment: string;
};

function rule(
  name: string,
  comment: string,
  from: ForbiddenRule["from"],
  to: ForbiddenRule["to"],
): ForbiddenRule {
  return { name, severity: "error", comment, from, to };
}

function fileOrDir(path: string): string {
  return `^${path}(\\.ts$|/)`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Регэксп пакетов npm для `to.path`: имя из импорта, когда пакет не установлен (`drizzle-orm/pg-core`), и путь
 * после разрешения — обычный `node_modules/<пакет>/` и pnpm `node_modules/.pnpm/<пакет>@…/node_modules/<пакет>/`.
 * Для пакетов без scope учитываются и типы `@types/<пакет>`. `@scope/*` — все пакеты scope.
 */
export function npmPattern(packages: readonly string[]): string {
  const names = packages.map((p) =>
    p.endsWith("/*")
      ? `${escapeRegExp(p.slice(0, -1))}[^/]+`
      : p.startsWith("@")
        ? escapeRegExp(p)
        : `(@types/)?${escapeRegExp(p)}`,
  );
  return `(^|node_modules/)(${names.join("|")})(/|$)`;
}

function ids(modules: readonly ModuleDef[]): string {
  return modules.map((m) => escapeRegExp(m.id)).join("|");
}

function moduleRules(modules: readonly ModuleDef[]): ForbiddenRule[] {
  const depsOf = modules.map((m) =>
    rule(
      `deps-of-${m.id}`,
      `Модуль ${m.id} может зависеть только от: ${m.dependsOn.join(", ") || "никого"} ` +
        "(tooling/architecture/modules.ts). Нужен результат модуля выше — событие или реестр (ADR-0004); " +
        "новая зависимость вниз — правка modules.ts с обоснованием в итоге задачи.",
      { path: `^${MOD}/${escapeRegExp(m.id)}/` },
      {
        path: `^${MOD}/[^/]+/`,
        pathNot: `^${MOD}/(${ids([m, ...modules.filter((d) => m.dependsOn.includes(d.id))])})/`,
      },
    ),
  );
  const tiers = [...new Set(modules.map((m) => m.tier))].toSorted((a, b) => a - b);
  const upward = tiers
    .filter((tier) => modules.some((m) => m.tier > tier))
    .map((tier) =>
      rule(
        `tier-${tier}-no-upward`,
        `Модуль яруса ${tier} не зависит от модулей ярусов выше: сообщить наверх — событием, ` +
          "подставить реализацию — реестром в корне композиции (ADR-0004).",
        { path: `^${MOD}/(${ids(modules.filter((m) => m.tier === tier))})/` },
        { path: `^${MOD}/(${ids(modules.filter((m) => m.tier > tier))})/` },
      ),
    );
  return [...depsOf, ...upward];
}

function layerRules(): ForbiddenRule[] {
  return [
    rule(
      "module-public-api-only",
      "В чужой модуль — только через его index.ts (фасад и типы); внутренности модуля закрыты (ADR-0003).",
      { path: `^${MOD}/([^/]+)/` },
      { path: `^${MOD}/[^/]+/`, pathNot: [`^${MOD}/$1/`, `^${MOD}/[^/]+/index\\.ts$`] },
    ),
    rule(
      "domain-is-pure",
      "domain/ — чистые правила: только свой domain/, @kosht/kernel, @kosht/calc; без платформы, БД, " +
        "других слоёв и модулей (ARCHITECTURE §4.2). Нужен ввод-вывод — это сценарий в application/.",
      { path: `^${MOD}/([^/]+)/domain/` },
      { path: `^${SERVER}/`, pathNot: `^${MOD}/$1/domain/` },
    ),
    rule(
      "api-thin",
      "api/, jobs/, agent/, subscriptions/ только вызывают сценарии application/, без репозиториев и SQL " +
        "(ARCHITECTURE §4.2). Исключение — *.sweep.ts: сквозной запрос «для всех» (§6.6).",
      {
        path: `^${MOD}/([^/]+)/(api|jobs|agent|subscriptions)/`,
        pathNot: String.raw`\.sweep\.ts$`,
      },
      { path: `^${MOD}/$1/infrastructure/` },
    ),
    rule(
      "infrastructure-not-to-application",
      "infrastructure/ реализует порты и не зависит от application/ и api/, кроме application/ports.ts " +
        "(ARCHITECTURE §4.2).",
      { path: `^${MOD}/([^/]+)/infrastructure/` },
      { path: `^${MOD}/$1/(application|api)/`, pathNot: `^${MOD}/$1/application/ports\\.ts$` },
    ),
    rule(
      "platform-not-to-modules",
      "platform/ — техника без бизнеса (ярус 0) и не импортирует modules/*: модуль подставляет себя через " +
        "реестр в main/compose.ts (ARCHITECTURE §2).",
      { path: `^${PLATFORM}/` },
      { path: `^${MOD}/` },
    ),
  ];
}

function appRules(): ForbiddenRule[] {
  const layersAbove: [string, string][] = [
    ["routes", "app"],
    ["features", "app|routes"],
    ["entities", "app|routes|features"],
    ["ui", "app|routes|features|entities"],
    ["lib", "app|routes|features|entities|ui"],
  ];
  return [
    rule(
      "server-not-to-web",
      "Сервер не импортирует сайт: общее — в packages/contract или packages/kernel.",
      { path: "^apps/server/" },
      { path: "^apps/web/" },
    ),
    rule(
      "web-not-to-server",
      "Сайт не импортирует сервер: процедуры и DTO — из @kosht/contract (ARCHITECTURE §2).",
      { path: "^apps/web/" },
      { path: "^apps/server/" },
    ),
    rule(
      "web-only-shared-packages",
      "Сайту доступны только @kosht/kernel, @kosht/contract, @kosht/i18n (и @kosht/testing в тестах): " +
        "числа считает сервер через @kosht/calc (P1), сайт показывает готовые.",
      { path: "^apps/web/" },
      { path: "^packages/", pathNot: "^packages/(kernel|contract|i18n|testing)/" },
    ),
    ...layersAbove.map(([layer, above]) =>
      rule(
        "web-layers-down",
        "Слои сайта импортируют только вниз: app → routes → features → entities → ui / lib (ADR-0014).",
        { path: `^${WEB}/${layer}/` },
        { path: `^${WEB}/(${above})/` },
      ),
    ),
    rule(
      "web-feature-isolation",
      "Фича не импортирует другую фичу: переход — Link, вопрос ассистенту — lib/assistant-bridge, общее — " +
        "в entities (ADR-0014).",
      { path: `^${WEB}/features/([^/]+)/` },
      { path: `^${WEB}/features/[^/]+/`, pathNot: `^${WEB}/features/$1/` },
    ),
    rule(
      "web-routes-thin",
      "Маршрут тонкий: только features/<экран>/index.ts и lib; entities и ui — внутри фичи (ADR-0014).",
      { path: `^${WEB}/routes/` },
      { path: `^${WEB}/(entities/|ui/|features/[^/]+/(?!index\\.tsx?$))` },
    ),
    rule(
      "ui-is-presentational",
      "ui/ — дизайн-система, только представление: без lib/api, lib/events, entities и features (ADR-0014).",
      { path: `^${WEB}/ui/` },
      { path: `^${WEB}/(lib/(api|events)(/|\\.tsx?$)|entities/|features/)` },
    ),
    rule(
      "ui-is-presentational",
      "ui/ — без запросов: TanStack Query и клиент oRPC подключают entities и features (ADR-0014).",
      { path: `^${WEB}/ui/` },
      { path: npmPattern(["@tanstack/react-query", "@orpc/*"]) },
    ),
  ];
}

function packageRules(): ForbiddenRule[] {
  return [
    rule(
      "calc-only-kernel",
      "@kosht/calc импортирует только @kosht/kernel: ни БД, ни сети, ни файлов (P1, ARCHITECTURE §2).",
      { path: "^packages/calc/", pathNot: TEST_CODE },
      { pathNot: "^packages/(calc|kernel)/" },
    ),
    rule(
      "kernel-only-zod",
      "@kosht/kernel зависит только от zod (ARCHITECTURE §2).",
      { path: "^packages/kernel/", pathNot: TEST_CODE },
      { pathNot: ["^packages/kernel/", npmPattern(["zod"])] },
    ),
    rule(
      "contract-allowed-deps",
      "@kosht/contract — форма данных «на проводе»: только zod, @orpc/contract и @kosht/kernel, без " +
        "серверного кода (ARCHITECTURE §2, ADR-0005).",
      { path: "^packages/contract/", pathNot: TEST_CODE },
      { pathNot: ["^packages/(contract|kernel)/", npmPattern(["zod", "@orpc/contract"])] },
    ),
    rule(
      "i18n-allowed-deps",
      "@kosht/i18n — тексты и форматы: только i18next, @kosht/kernel и @kosht/contract, без приложений и " +
        "серверного кода (ARCHITECTURE §2). Тесты правилом не проверяются (там и @kosht/calc — сверка словарей).",
      { path: "^packages/i18n/", pathNot: TEST_CODE },
      { pathNot: ["^packages/(i18n|kernel|contract)/", npmPattern(["i18next"])] },
    ),
    rule(
      "testing-not-in-prod",
      "@kosht/testing, тесты, фикстуры и кассеты — только для тестов, не в боевом коде (ARCHITECTURE §2).",
      {
        path: "^(apps|packages)/",
        pathNot: [...TEST_CODE, String.raw`(^|/)vitest[^/]*\.config\.ts$`],
      },
      { path: TEST_CODE },
    ),
  ];
}

function isolationRules(modules: readonly ModuleDef[]): ForbiddenRule[] {
  const unflagged = modules.filter((m) => !systemTables(m));
  return [
    rule(
      "schema-only-in-infrastructure",
      "Схема таблиц модуля — только в его infrastructure/ (а также user-data.ts, *.sweep.ts и тестах): " +
        "запросы пишут репозитории (ARCHITECTURE §6.2, замок 4).",
      {
        path: `^${MOD}/([^/]+)/`,
        pathNot: [
          `^${MOD}/[^/]+/infrastructure/`,
          `^${MOD}/[^/]+/user-data\\.ts$`,
          String.raw`\.sweep\.ts$`,
          ...TEST_CODE,
        ],
      },
      { path: `^${MOD}/$1/infrastructure/db/schema(\\.ts$|/)` },
    ),
    rule(
      "schema-only-in-infrastructure",
      "Чужая схема недоступна: данные соседа — через его фасад в index.ts (ARCHITECTURE §6.2, замок 4).",
      { path: `^${MOD}/([^/]+)/` },
      { path: `^${SCHEMA}`, pathNot: `^${MOD}/$1/` },
    ),
    rule(
      "schema-only-in-infrastructure",
      "Схемы модулей вне модулей видят только тесты и drizzle.config.ts (ARCHITECTURE §6.2, замок 4).",
      { pathNot: [`^${MOD}/`, "^apps/server/drizzle\\.config\\.ts$", ...TEST_CODE] },
      { path: `^${SCHEMA}` },
    ),
    rule(
      "schema-only-in-infrastructure",
      "Схема таблиц папки платформы — только для своей папки (репозиторий): соседняя папка платформы работает " +
        "через её функции, а не через таблицы (ARCHITECTURE §6.2, замок 4).",
      { path: `^${PLATFORM}/([^/]+)/`, pathNot: TEST_CODE },
      { path: PLATFORM_SCHEMA, pathNot: `^${PLATFORM}/$1/` },
    ),
    rule(
      "schema-only-in-infrastructure",
      "Схемы платформы (settings, secrets, rate_limits) вне платформы видят только тесты и drizzle.config.ts: " +
        "модуль читает настройки и секреты через их функции, а не через таблицы (ARCHITECTURE §6.2, замок 4).",
      { pathNot: [`^${PLATFORM}/`, "^apps/server/drizzle\\.config\\.ts$", ...TEST_CODE] },
      { path: PLATFORM_SCHEMA },
    ),
    rule(
      "no-cross-module-repo",
      "Репозиторий модуля вызывает только сам модуль; соседу — фасад в index.ts (ARCHITECTURE §4.3).",
      { path: `^${MOD}/([^/]+)/` },
      { path: `^${REPO}`, pathNot: `^${MOD}/$1/` },
    ),
    rule(
      "no-cross-module-repo",
      "Репозитории модулей вне модулей видят только тесты (ARCHITECTURE §4.3).",
      { pathNot: [`^${MOD}/`, ...TEST_CODE] },
      { path: `^${REPO}` },
    ),
    rule(
      "no-cross-module-repo",
      "index.ts не выставляет наружу infrastructure/db: публичный API — фасад и типы (ARCHITECTURE §4.1).",
      { path: `^${MOD}/([^/]+)/index\\.ts$` },
      { path: `^${MOD}/$1/infrastructure/db/` },
    ),
    rule(
      "no-unsafe-db",
      "unsafeRaw — только миграции (platform/db) и тесты; данные пользователя — через ScopedDb (ADR-0006).",
      { pathNot: [`^${PLATFORM}/db/`, ...TEST_CODE] },
      { path: fileOrDir(PLATFORM_DB.unsafe) },
    ),
    rule(
      "db-internals-only-in-platform-db",
      "Аудитор и auditedDrizzle — только внутри platform/db и в тестах: режим аудита с householdId выдаёт " +
        "ScopedDb из scope запроса, а не модуль (ADR-0006, ARCHITECTURE §6.2).",
      { pathNot: [`^${PLATFORM}/db/`, ...TEST_CODE] },
      {
        path: [fileOrDir(PLATFORM_DB_INTERNALS.audit), fileOrDir(PLATFORM_DB_INTERNALS.audited)],
      },
    ),
    rule(
      "db-internals-only-in-platform-db",
      "Пул и миграции — только platform/db, корень композиции main/ и тесты: модуль получает s: ScopedDb, " +
        "а не соединение (ADR-0006, ARCHITECTURE §6.2).",
      { pathNot: [`^${PLATFORM}/db/`, `^${SERVER}/main/`, ...TEST_CODE] },
      {
        path: [
          fileOrDir(PLATFORM_DB_INTERNALS.connection),
          fileOrDir(PLATFORM_DB_INTERNALS.migrate),
        ],
      },
    ),
    rule(
      "cross-tenant-only-in-sweeps",
      "crossTenant — только defineSweep (platform/jobs) и *.sweep.ts: запрос «для всех» возвращает " +
        "(id, householdId, userId), дальше — задача под scope владельца (ARCHITECTURE §6.6).",
      { pathNot: [`^${PLATFORM}/(db|jobs)/`, String.raw`\.sweep\.ts$`, ...TEST_CODE] },
      { path: fileOrDir(PLATFORM_DB.crossTenant) },
    ),
    rule(
      "boss-db-only-in-jobs",
      "Подключение pg-boss к пулу и транзакции (boss-db) — только platform/jobs, корень композиции main/ " +
        "(схему очереди ставит владелец) и тесты: задачу ставит jobs.enqueue(tx, …), событие — " +
        "events.publish(tx, …) (ADR-0008). Служебные запросы pg-boss идут мимо аудитора SQL.",
      { pathNot: [`^${PLATFORM}/(db|jobs)/`, `^${SERVER}/main/`, ...TEST_CODE] },
      { path: fileOrDir(PLATFORM_DB.boss) },
    ),
    rule(
      "system-db-only-for-flagged-modules",
      "SystemDb — только модулям с таблицами system или public в modules.ts (ARCHITECTURE §6.5). Нужны " +
        "системные данные — фасад модуля-владельца.",
      { path: `^${MOD}/(${ids(unflagged)})/` },
      { path: fileOrDir(PLATFORM_DB.system) },
    ),
    rule(
      "admin-no-user-data",
      "admin не видит схем и репозиториев ни одного модуля (PRIV-07): данные — admin-фасады модулей.",
      { path: `^${MOD}/admin/` },
      { path: `^${MOD}/[^/]+/infrastructure/db/` },
    ),
    rule(
      "admin-no-user-data",
      "admin ходит в чужие модули только через их index.ts (PRIV-07, ARCHITECTURE §6.5).",
      { path: `^${MOD}/admin/` },
      { path: `^${MOD}/[^/]+/`, pathNot: [`^${MOD}/admin/`, `^${MOD}/[^/]+/index\\.ts$`] },
    ),
  ];
}

function libraryRules(): ForbiddenRule[] {
  return [
    rule(
      "ai-sdk-only-in-llm",
      "Провайдеры @ai-sdk/* на сервере знает только шлюз llm (ADR-0009, CONSTRAINTS «Архитектурные запреты»).",
      { path: `^${SERVER}/`, pathNot: `^${MOD}/llm/` },
      { path: npmPattern(["@ai-sdk/*"]) },
    ),
    rule(
      "ai-only-in-llm-agent-chat",
      "Пакет ai на сервере — только в llm, agent и chat (правило llm, ADR-0009).",
      { path: `^${SERVER}/`, pathNot: `^${MOD}/(llm|agent|chat)/` },
      { path: npmPattern(["ai"]) },
    ),
    rule(
      "otel-only-in-llm-telemetry",
      "Трассы ИИ (@langfuse/*, @opentelemetry/*) — только в llm/infrastructure/telemetry: остальной код получает " +
        "опции трасс от шлюза llm и порта platform/telemetry (ADR-0010).",
      { path: `^${SERVER}/`, pathNot: [`^${MOD}/llm/infrastructure/telemetry/`] },
      { path: npmPattern(["@langfuse/*", "@opentelemetry/*"]) },
    ),
    rule(
      "sharp-only-in-llm-images",
      "Обработка изображений (sharp) — только в llm/infrastructure/images: перед облаком изображение перекодируется " +
        "без метаданных (EXIF, геометки), остальной код получает готовые байты от шлюза llm (PRIV-04).",
      { path: `^${SERVER}/`, pathNot: [`^${MOD}/llm/infrastructure/images/`] },
      { path: npmPattern(["sharp"]) },
    ),
    rule(
      "transformers-only-in-llm-masking",
      "Локальная NER-модель (@huggingface/transformers, onnxruntime) — только в llm/infrastructure/masking: " +
        "остальной код получает маскирование через порт Masker шлюза llm (PRIV-03, ADR-0009).",
      { path: `^${SERVER}/`, pathNot: [`^${MOD}/llm/infrastructure/masking/`] },
      { path: npmPattern(["@huggingface/*", "onnxruntime-node", "onnxruntime-web"]) },
    ),
    rule(
      "ai-only-in-web-assistant",
      "AI SDK на сайте (ai, @ai-sdk/react) — только в features/assistant: чат с потоком ответа; остальные экраны " +
        "получают готовые данные процедурами (ADR-0009, ADR-0013).",
      { path: `^${WEB}/`, pathNot: [`^${WEB}/features/assistant/`, ...TEST_CODE] },
      { path: npmPattern(["ai", "@ai-sdk/*"]) },
    ),
    rule(
      "pg-boss-only-in-platform-jobs",
      "pg-boss — только в platform/jobs: задачи — defineJob, события — events.publish (ADR-0008).",
      { pathNot: `^${PLATFORM}/jobs/` },
      { path: npmPattern(["pg-boss"]) },
    ),
    rule(
      "libpg-query-only-in-platform-db",
      "libpg-query (парсер PostgreSQL) — только в platform/db: им читает запросы аудитор SQL (ADR-0019).",
      { pathNot: `^${PLATFORM}/db/` },
      { path: npmPattern(["libpg-query"]) },
    ),
    rule(
      "grammy-only-in-telegram-infrastructure",
      "grammY — только в telegram/infrastructure; наружу — канал доставки DeliveryChannel (ARCHITECTURE §4.4).",
      { pathNot: `^${MOD}/telegram/infrastructure/` },
      { path: npmPattern(["grammy", "@grammyjs/*"]) },
    ),
    rule(
      "better-auth-only-in-identity-infrastructure",
      "Better Auth — только в identity/infrastructure: вход, выход и сессия — процедуры identity, остальным " +
        "модулям — scope из сессии (ADR-0016).",
      { pathNot: `^${MOD}/identity/infrastructure/` },
      { path: npmPattern(["better-auth", "@better-auth/*"]) },
    ),
    rule(
      "nodemailer-only-in-mail-infrastructure",
      "Nodemailer — только в mail/infrastructure: письма отправляет фасад mail (SMTP или локальный ящик), " +
        "остальные модули SMTP не открывают (ADR-0016).",
      { pathNot: `^${MOD}/mail/infrastructure/` },
      { path: npmPattern(["nodemailer"]) },
    ),
    rule(
      "drizzle-and-pg-only-in-db",
      "drizzle-orm и pg — только в infrastructure/db модулей и platform/db: запросы через ScopedDb " +
        "(ADR-0006, CONSTRAINTS «Архитектурные запреты»). Исключения: @kosht/testing/db — шаблонная " +
        "база тестов создаёт и удаляет базы test_* (ARCHITECTURE §12), данных пользователя не читает; " +
        "schema.ts и *.repo.ts платформы settings, secrets, rate-limit, jobs — системные таблицы платформы " +
        "(T-005, T-006).",
      {
        pathNot: [
          `^${MOD}/[^/]+/infrastructure/db/`,
          `^${PLATFORM}/db/`,
          String.raw`^packages/testing/src/db(\.ts$|/)`,
          PLATFORM_TABLES,
        ],
      },
      { path: npmPattern(["drizzle-orm", "pg"]) },
    ),
    rule(
      "orpc-server-only-in-api",
      "@orpc/server и @orpc/openapi — только в api/ модулей, platform/http и main (ADR-0005).",
      { pathNot: [`^${MOD}/[^/]+/api/`, `^${PLATFORM}/http/`, `^${SERVER}/main/`] },
      { path: npmPattern(["@orpc/server", "@orpc/openapi"]) },
    ),
  ];
}

/** Не обходятся: сборки приложений и пакетов (и сборка сайта стенда e2e — dist-e2e), фикстуры нарушений. */
export const EXCLUDE = ["^(apps|packages)/[^/]+/dist(-e2e)?/", `^${FIXTURES_DIR}/`] as const;

/** Все запреты dependency-cruiser для карты модулей; одно имя может объединять несколько условий. */
export function buildForbiddenRules(modules: readonly ModuleDef[]): ForbiddenRule[] {
  return [
    rule(
      "no-circular",
      "Циклический импорт: вынесите общее вниз или замените связь событием (ADR-0004).",
      {},
      { circular: true },
    ),
    rule(
      "not-to-unresolvable",
      "Импорт не разрешается: опечатка в пути, нет пакета в package.json или резолвер не видит " +
        "workspace-пакет — проверка границ на таком ребре молчит (ADR-0002).",
      {},
      { couldNotResolve: true },
    ),
    ...layerRules(),
    ...moduleRules(modules),
    ...appRules(),
    ...packageRules(),
    ...isolationRules(modules),
    ...libraryRules(),
  ];
}

/** Общие настройки обхода: и для make deps-check, и для тестов правил на фикстурах. */
export function cruiseOptions(): ICruiseOptions {
  return {
    // TypeScript 7 dependency-cruiser 18.7 не понимает: рядом стоит TS 6 (packageExtensions, ADR-0002).
    parser: "tsc",
    // Импорт только типов — тоже граница: тип из чужого domain/ так же связывает модули.
    tsPreCompilationDeps: true,
    doNotFollow: { path: ["(^|/)node_modules/"] },
    // Исключённый модуль пропадает из графа вместе с ребром, поэтому node_modules и чужие dist/ не исключаем
    // (иначе запреты библиотек молча не срабатывают): пакеты остаются листьями графа (doNotFollow).
    exclude: { path: [...EXCLUDE] },
    enhancedResolveOptions: {
      // Workspace-пакеты @kosht/* отдают исходники .ts через exports (ADR-0002).
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json", ".d.ts"],
    },
  };
}

/** Конфигурация .dependency-cruiser.mjs: правила из карты и настройки обхода. */
export function buildConfig() {
  return { forbidden: buildForbiddenRules(MODULES), options: cruiseOptions() };
}
