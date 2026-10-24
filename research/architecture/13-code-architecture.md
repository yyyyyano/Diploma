> **Справочник для обсуждения, а не требования.** Окончательные решения — после согласования с пользователем,
> затем ADR и `docs/ARCHITECTURE.md`. Требования — только в [`SPEC.md`](../../SPEC.md); стек — в
> [`10-consensus.md`](10-consensus.md) (здесь он не пересматривается).

# 13. Архитектура кода «Кошта»: раскладка, модули, границы, конвенции, правила для агентов

Метки уверенности: **[В]** проверил сам (прототип, запуск, документация), **[С]** косвенно, **[Н]** моё
предложение/оценка. Прототип правил границ — `…/scratchpad/research-architecture/` (`node_modules` удалены).

## Краткое резюме

1. **Монорепа из двух приложений и пяти пакетов.** `apps/web` (сайт), `apps/server` (весь бэкенд: три
   процесса — `api`, `worker`, `bot` — из одного кода), `packages/kernel` (общие типы: деньги, даты, `Scope`,
   идентификаторы), `packages/calc` (все числа P1, каждое — `{ value, trace }`), `packages/contract` (oRPC + Zod —
   единственное, что фронт знает о сервере), `packages/i18n` (словари и форматы для сайта, бота, писем),
   `packages/testing` (фабрики, тестовая БД, «кассеты» моделей). Плюс `e2e/`, `datasets/`, `tooling/`.
2. **Бэкенд — модульный монолит: 36 модулей в 4 ярусах.** Модуль = папка с фасадом `index.ts`, внутри —
   `domain/` (чистые правила), `application/` (по файлу на сценарий), `infrastructure/` (БД и внешние сервисы),
   `api/`, `jobs/`, `agent/`. Порты (интерфейсы) — только на внешних границах. Модули зовут друг друга **через
   фасад вниз**, а **вверх сообщают событиями** (pg-boss в той же транзакции).
3. **Карта модулей — это код** (`tooling/architecture/modules.ts`): из неё генерируются правила
   dependency-cruiser («модуль X может зависеть только от …»), черновик `CAPABILITIES.md` и проверка порядка сборки.
   Прототип: все 16 подложенных нарушений пойманы, ложных нет; страховка «0 модулей» срабатывает [В].
4. **Изоляция данных — двойной замок:** `Scope` — обязательный первый аргумент каждого сценария (без него код не
   скомпилируется) **и** политики RLS в Postgres (без `Scope` запрос вернёт пустоту, а не чужие данные). Транзакция
   открывается сценарием, а репозитории берут её из контекста запроса (`AsyncLocalStorage`).
5. **ИИ:** только модуль `llm` знает провайдеров. Он отдаёт агенту «цепочку как одну модель» (маскирование, лимиты,
   переключение, журнал, Langfuse — внутри). Инструменты агента лежат в модулях-владельцах, описываются своим
   `defineTool` без AI SDK и собираются в корне композиции — агент не импортирует ни одного предметного модуля.
6. **Фронтенд — упрощённый FSD:** `app → routes → features → entities → ui / lib`. `features` = экраны из
   `design/SCREENS.md`, `ui` = дизайн-система «Пуща и янтарь» поверх Mantine (без запросов к серверу), `lib` = клиент
   oRPC, поток событий, i18n. Фронт не импортирует сервер и `calc` — числа приходят готовыми.
7. **Агентам** — паспорт `CLAUDE.md` в каждом модуле и фиче + 12 сквозных правил `.claude/rules/*.md` с `paths:`.
8. **«Бетонная» фаза — 9 шагов** до первой бизнес-функции; главная её проверка — «сквозной срез» (контракт → роутер →
   RLS → сайт → e2e) и набор «должно упасть» для каждого правила границ.

---

## 1. Раскладка монорепы

### 1.1 Дерево

```
kosht/                                   (= DiplomaSupport/yana/)
├─ apps/
│  ├─ web/                 сайт: Vite + React 19 SPA (раздел 3)
│  └─ server/              весь бэкенд, один пакет @kosht/server
│     └─ src/
│        ├─ entrypoints/   api.ts · worker.ts · bot.ts — три процесса, один код
│        ├─ main/          корень композиции: compose.ts (сборка модулей), router.ts (дерево oRPC)
│        ├─ platform/      «ярус 0»: config, logging, context, db, jobs, events, errors, clock,
│        │                 blob-store, secrets, settings, http, rate-limit, telemetry, tools (defineTool)
│        └─ modules/       36 модулей (раздел 2.4), у каждого CLAUDE.md-паспорт
├─ packages/
│  ├─ kernel/              общие типы и примитивы: Money, LocalDate, Period, Scope, id-бренды, Trace-типы
│  ├─ calc/                чистые расчёты P1/P2: только вход → { value, trace }
│  ├─ contract/            oRPC-контракт + Zod DTO, каталог ошибок, части сообщений чата, события, контекст страницы
│  ├─ i18n/                словари ru (be — задел), типизированные ключи, formatMoney/formatDate (Intl)
│  └─ testing/             фабрики, шаблонная тестовая БД, FakeClock/MemoryBlobStore, кассеты моделей
├─ e2e/                    Playwright + axe (@kosht/e2e), свои кассеты для сценариев
├─ datasets/               эталонные наборы: синтетические выписки, чеки, сохранённые страницы pravo.by,
│                          правовые вопросы (QA-11…15) — общие для тестов и eval
├─ tooling/                не пакет: tsconfig.base.json, architecture/modules.ts, генератор правил границ,
│                          checks/*.mjs (deps-guard, no-raw-colors, calc-no-clock…), synth/ (генераторы наборов),
│                          gen/ (заготовки модуля и фичи), commit-size.mjs
├─ docs/                   ARCHITECTURE.md, CAPABILITIES.md, adr/NNNN-*.md
├─ tasks/                  plan.md, todo.md, reports/<ID>/ (конвейер агентов, 09)
├─ .claude/                agents/, commands/, rules/, settings.json
├─ docker/                 Dockerfile, конфиги сервисов; compose.yaml и Makefile — в корне
├─ samples/  data/  models/   вне git (.gitignore): образцы пользователя, данные запуска, локальные модели
└─ pnpm-workspace.yaml · turbo.json · .oxlintrc.json · .oxfmtrc.json · .dependency-cruiser.mjs
   lefthook.yml · commitlint.config.ts · CLAUDE.md · .env.example
```

### 1.2 Кто за что отвечает и что ему запрещено

| Папка | Ответственность | Запрещено (проверяется) |
|---|---|---|
| `apps/web` | Экраны, состояния, взаимодействия | импорт `apps/server`, `packages/calc`, `packages/testing` (кроме тестов); «сырые» цвета вне `ui/theme` |
| `apps/server/src/entrypoints` | Запуск процесса, сигналы завершения | бизнес-логика (только `compose()` и старт) |
| `apps/server/src/main` | Корень композиции: создать платформу, модули по порядку, зарегистрировать роутеры, задачи, подписки, инструменты, каналы | логика сверх «соединить» |
| `apps/server/src/platform` | Техника без бизнеса: БД, транзакции, очередь, логи, ошибки, настройки, секреты, HTTP | импорт любых `modules/*` |
| `apps/server/src/modules/<id>` | Одна возможность SPEC целиком | глубокий импорт чужого модуля; зависимость не из своего списка `dependsOn` |
| `packages/kernel` | Типы, которые нужны всем: деньги в копейках, даты по Минску, `Scope`, бренды id, `TraceNode` | любые зависимости, кроме `zod` |
| `packages/calc` | Все финансовые/налоговые/проверочные расчёты | всё, кроме `kernel`: ни БД, ни сети, ни `Date.now()`, ни `Math.random()` |
| `packages/contract` | Форма данных «на проводе»: процедуры, DTO, ошибки, карточки чата, события | серверный код; зависимости, кроме `zod`, `@orpc/contract`, `kernel` |
| `packages/i18n` | Тексты и форматы чисел/дат | импорт приложений; тексты в коде мимо словаря |
| `packages/testing` | Помощники тестов | импорт из боевого кода (правило `no-test-code-in-prod`) |
| `e2e/` | 5–8 ключевых сценариев + axe на каждом маршруте | походы в интернет (сервер в режиме «кассеты») |
| `datasets/` | Данные эталонов (с описанием происхождения, без реальных ПД — NFR-18) | реальные выписки и фото пользователя |

**Почему контракт и домен — разные пакеты.** `contract` — «как выглядит на проводе» (может меняться ради экрана),
`kernel` — «что такое деньги и дата» (меняется почти никогда), `calc` — «как считать» (самые строгие тесты).
Пример: добавили в карточку операции поле «Заметка» — меняется только `contract`, `calc` даже не перекомпилируется.

**Почему UI-кит не отдельный пакет.** Потребитель один — `apps/web` (админка — его часть, бот рисует не React).
Дизайн-система живёт в `apps/web/src/ui` со своим паспортом и правилом «только представление». Вынести в
`packages/ui` — механический перенос, когда появится второй потребитель.

### 1.3 Точки входа сервера: один пакет, три процесса

| Процесс | Что делает | Почему отдельно |
|---|---|---|
| `api` | oRPC (сайт), поток чата, поток событий `events.stream`, статика сайта, два порта (локальный 127.0.0.1 и сетевой — NFR-24) | должен отвечать быстро; тяжёлый разбор PDF/HEIC его не тормозит |
| `worker` | обработчики pg-boss: распознавание чеков, импорт выписок, загрузчик законов (один поток, LAW-35), эмбеддинги, расписания, подписки на события | падение или долгий разбор не роняет сайт; загрузчик законов живёт строго в одном процессе |
| `bot` | grammY long polling с консультативной блокировкой Postgres (один опрашивающий, 06) | токен меняется в админке → перезапуск только бота; ошибка Telegram не трогает сайт |

Все три вызывают одну функцию `compose(config, role)` и берут из результата нужное. В Compose — три службы из
одного образа с разной командой; `make dev` поднимает те же три процесса через `node --watch` и Vite. Общение
процессов — только через Postgres: задачи (pg-boss) и мгновенные сигналы `LISTEN/NOTIFY` (прогресс чека в браузере
приходит из воркера через `api` → `events.stream`). Одна топология в разработке и на показе — меньше сюрпризов.

---

## 2. Архитектура бэкенда

### 2.1 Сравнение подходов (для ~36 модулей SPEC)

| | А. Модульный монолит со «слоями внутри модуля» и сценариями | Б. Гексагональная («порты и адаптеры») на каждый модуль | В. Вертикальные срезы по сценариям без модулей |
|---|---|---|---|
| Суть | Модуль = папка с фасадом; внутри `domain / application / infrastructure`, сценарий = файл; порты только там, где внешний мир | Внутри модуля ядро и порт на **каждую** зависимость (репозиторий, часы, другой модуль), адаптеры снаружи | Папка на сценарий («загрузить чек», «импорт выписки»), всё нужное рядом; общий слой данных |
| Пример «добавить поле в чек» | схема БД → репозиторий → сценарий → контракт: 4 файла в одном модуле | то же + интерфейс порта репозитория и его адаптер: 6 файлов | 1–2 папки сценариев, но таблица общая — правка может задеть чужие срезы |
| Границы проверяются | dependency-cruiser (фасад, список зависимостей) | то же | слабо: срезы свободно лезут в общие таблицы |
| Тесты | чистое — без БД; сценарии — на настоящем Postgres (быстро, 03) | всё на фейках портов: быстро, но часто «зелёные» при сломанном SQL | на БД |
| Шаблонный код на 36 модулей | умеренно | много (порт+адаптер на каждый репозиторий ×36) | мало |
| Удобство для агентов | высокое: место для кода предсказуемо, задача ≈ «новый файл сценария + тест» | среднее: много косвенности, агенты плодят лишние интерфейсы | высокое для фич, низкое для «чьи это данные» |
| Изоляция «админ не видит финансы» | естественно: модуль `admin` не может импортировать финансовые модули | так же | трудно: общая модель данных |

**Выбор: А**, с двумя приёмами из других вариантов: из Б — **порты только на внешних границах** (часы, файлы,
модели, pravo.by, НБРБ, Telegram, почта: их подменяем в тестах офлайн, NFR-11); из В — **сценарий = отдельный файл**
(`application/recognize-receipt.ts`), а не толстый «сервис на 40 методов». Это даёт короткие файлы, ясные задачи
для агентов и честные интеграционные тесты на реальной БД.

Что изменило бы выбор: если бы тесты на Postgres оказались медленными (>1 с на файл) — больше фейков (сдвиг к Б);
если бы модулей было 5–6 — хватило бы В.

### 2.2 Структура одного модуля

Общая форма (у маленьких модулей лишних папок просто нет):

```
modules/<id>/
├─ CLAUDE.md          паспорт модуля (раздел 6.3)
├─ index.ts           ПУБЛИЧНЫЙ API: типы фасада + фабрика create<Id>Module. Больше наружу ничего
├─ module.ts          фабрика: собирает сценарии, фасад, роутер, задачи, подписки, инструменты
├─ facade.ts          что модуль даёт ДРУГИМ модулям (узко, по их нуждам)
├─ events.ts          события, которые модуль ПУБЛИКУЕТ (имя + Zod-схема полезной нагрузки)
├─ settings.ts        настройки модуля (defineSetting: ключ, схема, умолчание, секрет ли)
├─ domain/            чистые типы, статусы, правила модуля. Без БД, сети, времени
├─ application/       сценарии: по файлу на сценарий + ports.ts (интерфейсы внешнего мира модуля)
├─ infrastructure/    db/schema.ts (Drizzle + RLS), db/*.repo.ts, адаптеры внешних сервисов модуля
├─ api/               router.ts — реализация своей части контракта (тонкие обработчики)
├─ jobs/              *.job.ts — обработчики pg-boss и расписания
├─ subscriptions/     on-*.ts — реакции на чужие события
└─ agent/             tools.ts — инструменты агента (defineTool)
```

Тесты лежат **рядом** с файлом: `recognize-receipt.test.ts` (без БД), `recognize-receipt.int.test.ts` (на Postgres),
кассеты — `__cassettes__/` рядом с тестом. Агент, открывший сценарий, сразу видит его тесты.

#### Пример 1: `receipts` (чеки, RCPT)

```
modules/receipts/
├─ CLAUDE.md
├─ index.ts                       export type { ReceiptsFacade } ; export { createReceiptsModule }
├─ module.ts
├─ facade.ts                      getWarrantyItems(), getCardForTransaction() — для calendar, chat, telegram
├─ events.ts                      receipts.recognized, receipts.needs-review, receipts.warranty-items-found
├─ settings.ts                    допуск 0,01 BYN, попыток перепроверки 2 (RCPT-05/06)
├─ domain/
│  ├─ receipt.ts                  статусы recognizing → rechecking → ok | needs-review; переходы
│  ├─ dedup-key.ts                УИ или «магазин+дата+время+итог» (RCPT-04)
│  ├─ recheck-message.ts          «строка 2: 3 × 2,49 ≠ 8,47» из результата валидатора
│  └─ warranty.ts                 признак «товар с гарантией» по категории и наименованию (RCPT-13)
├─ application/
│  ├─ ports.ts                    QrDecoder, ImagePreparer
│  ├─ upload-receipts.ts          приём фото → files → запись «распознаётся» → задача (RCPT-01/02)
│  ├─ recognize-receipt.ts        QR → модель → calc.validateReceipt → перепроверка ≤2 → сохранить → операция
│  ├─ receipt-extraction.ts       Zod-схема извлечения + текст подсказки + версия подсказки (LLM-04)
│  ├─ edit-receipt-items.ts       ручная правка → повторная проверка (RCPT-08)
│  ├─ confirm-receipt.ts · undo-receipt.ts · get-receipt.ts · list-receipts.ts
├─ infrastructure/
│  ├─ db/schema.ts                receipts, receipt_items (userOwnedTable → RLS)
│  ├─ db/receipts.repo.ts
│  ├─ qr/zxing-qr-decoder.ts      zxing-wasm, локальный .wasm (06)
│  └─ image/sharp-preparer.ts · image/heic-decoder.ts
├─ api/router.ts                  contract.receipts.* → сценарии
├─ jobs/recognize.job.ts          receipts.recognize (priority 10, singletonKey = receiptId)
├─ subscriptions/on-transactions-merged.ts   перепривязать чек к операции из выписки (TXN-10)
└─ agent/tools.ts                 get_receipt, receipt_status
```

#### Пример 2: `legal-base` (правовая база, LAW) — большой модуль с подобластями

```
modules/legal-base/
├─ CLAUDE.md · index.ts · module.ts · events.ts · settings.ts (ночное окно, контакт загрузчика, пределы)
├─ facade.ts                      search(), getFragment(), getActCard(), isCurrent(versionIds), recordDemand()
│                                 + admin-фасад: сводка, кандидаты, журналы, редакторы справочников (ADM-10)
├─ domain/
│  ├─ act.ts · fragment-path.ts   виды актов, статусы; путь «НК › Гл. 16 › Ст. 209 › п. 1 › пп. 1.1»
│  ├─ reference.ts                разбор «п. 3 ст. 13 Закона о ЗПП» → ссылка (LAW-21 шаг 1)
│  ├─ routing-table.ts            таблица маршрутов LAW-17 — чистая функция (источник, текст, тема) → куда
│  ├─ relevance-filters.ts        фильтры LAW-13 без модели, с причиной отсева
│  ├─ version-diff.ts             сопоставление редакций по путям и тексту (LAW-31)
│  └─ quarantine.ts               правила карантина LAW-39
├─ application/
│  ├─ ports.ts                    LegalSource (pravo.by), Embedder
│  ├─ catalog/                    load-starter-catalog · add-act-by-url · decide-candidate · edit-dictionaries
│  ├─ sync/                       daily-check · check-act · process-new-arrivals · expand-reference-graph · effective-date-check
│  ├─ index/                      ingest-snapshot (разбор → фрагменты → версии) · embed-fragments · reindex-model
│  ├─ search/                     search-law (точный → гибрид RRF → фильтр → граф) · get-fragment · get-act-card
│  └─ public/                     list-acts · get-act-text (публичная «База законов», LEGAL-11)
├─ infrastructure/
│  ├─ db/schema.ts                acts, act_aliases, act_snapshots, fragments, fragment_versions, embedding_models,
│  │                              fragment_embeddings, law_candidates, law_fetch_log, law_update_log, demand_log…
│  │                              (системные/публичные таблицы — без RLS)
│  ├─ db/hybrid-search.sql.ts     SQL гибридного поиска (две CTE + FULL JOIN, RRF k=60 — 03)
│  ├─ pravo-by/                   polite-fetcher (1 поток, 3–5 с, лесенка повторов) · robots · card-parser ·
│  │                              text-parser (cheerio) · new-arrivals-parser
│  └─ starter-catalog.ts          28 актов §6.19.1 как данные
├─ api/router.ts                  публичные процедуры contract.laws.*
├─ jobs/                          law.daily-check, law.check-act, law.new-arrivals, law.embed, law.reindex-model…
├─ subscriptions/on-system-initialized.ts   старт загрузки стартового каталога (LAW-10)
├─ agent/tools.ts                 search_law, get_law_fragment, law_act_card
└─ __fixtures__/pravo-by/*.html   сохранённые страницы актов для офлайн-тестов разборщика (LAW-39)
```

Правило для больших модулей: подпапки внутри `application/` по подобластям, но **один фасад и один `index.ts`**.
Если подобласть начинает жить своей жизнью (свои таблицы, свои потребители) — выделяется в модуль через ADR.

### 2.3 Код модуля на примере (один хороший пример вместо трёх абзацев)

**Типы ядра** (`packages/kernel`):

```ts
// packages/kernel/src/scope.ts
/** Чьи это данные. Создаётся только на входе (HTTP, Telegram, задача) — никогда из аргументов модели. */
export interface Scope {
  readonly userId: UserId;
  readonly householdId: HouseholdId; // в MVP = своё домохозяйство из одного человека (задел DIP-03)
  readonly channel: "web" | "telegram" | "job" | "system";
}

// packages/kernel/src/money.ts — деньги только в целых копейках, никаких float
export interface Money { readonly minor: number; readonly currency: CurrencyCode } // 1 234,56 BYN → 123456
```

**Расчёт с трассой** (`packages/calc`, P1 + P2):

```ts
// packages/calc/src/fin/free-balance.ts
import { type Calc, money, node, sub, avg } from "../trace.ts";

export interface FreeBalanceInput {
  months: LocalMonth[];                       // последние полные месяцы (≤ 3), «сегодня» передаётся снаружи
  regularIncome: RefMoney[];                  // { money, ref: { kind: "transaction", id } }
  obligations: { group: ObligationGroup; items: RefMoney[] }[]; // ЖКХ, связь, кредиты, подписки…
}

/** FIN-20: свободный остаток = средний регулярный доход − средние обязательные платежи. */
export function freeBalance(input: FreeBalanceInput): Calc<Money> {
  const income = avg("fin.avgIncome", input.regularIncome, input.months.length);
  const payments = input.obligations.map((o) =>
    avg(`fin.obligation.${o.group}`, o.items, input.months.length));
  const result = sub("fin.freeBalance", income, payments);
  return input.months.length < 3 ? { ...result, trace: { ...result.trace, note: "fin.partialHistory" } } : result;
}
// trace = { key: "fin.freeBalance", op: "sub", value: 84000 BYN,
//           inputs: [{ key: "fin.avgIncome", value: 240000, refs: [txn…] }, { key: "fin.obligation.utilities", … }] }
// Сайт рисует из трассы «2 400 − 180 − 35 − 1 200 − 145 = 840 BYN» и ссылки на операции (EXPL-01).
```

**Контракт** (`packages/contract`):

```ts
// packages/contract/src/receipts/receipts.contract.ts
export const receiptsContract = {
  upload: oc.route({ method: "POST", path: "/receipts" })
    .input(z.object({ files: z.array(z.file()).min(1).max(10) }))
    .output(z.object({ receipts: z.array(ReceiptSummary) }))
    .errors(pickErrors("UNSUPPORTED_FILE", "FILE_TOO_LARGE")),
  get: oc.route({ method: "GET", path: "/receipts/{id}" })
    .input(z.object({ id: ReceiptId }))
    .output(ReceiptDto)                        // DTO ≠ строка БД: без путей к файлам и служебных полей
    .errors(pickErrors("NOT_FOUND")),
  updateItems: oc.input(UpdateReceiptItemsInput).output(ReceiptDto).errors(pickErrors("NOT_FOUND", "CONFLICT")),
};
```

**Публичный вход и фабрика модуля:**

```ts
// modules/receipts/index.ts — всё, что видят другие модули
export type { ReceiptsFacade } from "./facade.ts";
export { createReceiptsModule, type ReceiptsDeps } from "./module.ts";

// modules/receipts/module.ts
export interface ReceiptsDeps {
  platform: Platform;                      // uow, jobs, events, clock, log, settings
  files: FilesFacade; transactions: TransactionsFacade; categories: CategoriesFacade;
  merchants: MerchantsFacade; llm: LlmGateway; actions: ActionsFacade; notifications: NotificationsFacade;
  qr?: QrDecoder; images?: ImagePreparer;  // в тестах — подмена
}

export function createReceiptsModule(d: ReceiptsDeps) {
  const repo = createReceiptsRepo();
  const useCases = {
    upload: makeUploadReceipts({ ...d, repo }),
    recognize: makeRecognizeReceipt({ ...d, repo, qr: d.qr ?? zxingQrDecoder(), images: d.images ?? sharpPreparer() }),
    get: makeGetReceipt({ repo }),
    updateItems: makeEditReceiptItems({ ...d, repo }),
  };
  return defineModule({
    id: "receipts",
    facade: createReceiptsFacade(repo),
    router: receiptsRouter(useCases),
    jobs: [recognizeJob(useCases.recognize)],
    subscriptions: [onTransactionsMerged(repo)],
    tools: receiptTools(useCases),
    userData: receiptsUserData(repo),        // экспорт и удаление (PRIV-05/06)
    undo: { "receipts.cancel": useCases.undo }, // P5: «Отменить» через модуль actions
  });
}
```

**Сценарий** — транзакции коротко, медленные вызовы между ними:

```ts
// modules/receipts/application/recognize-receipt.ts
export function makeRecognizeReceipt(d: RecognizeDeps) {
  return async function recognizeReceipt(scope: Scope, receiptId: ReceiptId): Promise<void> {
    // 1. Короткая транзакция: прочитать. RLS видит только строки этого домохозяйства.
    const draft = await d.platform.uow.run(scope, () => d.repo.getForRecognition(receiptId));
    const image = await d.images.prepare(await d.files.read(scope, draft.photoFileId));
    const uid = await d.qr.decode(image);                          // RCPT-04: локально, без модели

    // 2. Модель — ВНЕ транзакции (LlmGateway сам падает, если его зовут внутри uow.run).
    let extracted = await d.llm.extract(scope, { task: "receipt.extract", ...receiptExtraction, images: [image] });
    let check = validateReceipt(extracted, d.settings.tolerance);   // packages/calc → { value, trace }
    for (let attempt = 1; !check.value.ok && attempt <= d.settings.maxRechecks; attempt++) {
      await d.platform.events.progress(scope, { receiptId, stage: "rechecking", line: check.value.firstBadLine });
      extracted = await d.llm.extract(scope, { task: "receipt.extract", ...recheckPrompt(extracted, check.value) });
      check = validateReceipt(extracted, d.settings.tolerance);
    }

    // 3. Короткая транзакция: сохранить, создать операцию, опубликовать событие — атомарно.
    await d.platform.uow.run(scope, async () => {
      const saved = await d.repo.saveRecognized(receiptId, extracted, check, uid);
      const txn = await d.transactions.recordFromReceipt(scope, toReceiptPurchase(saved)); // TXN-10 внутри transactions
      await d.platform.events.publish("receipts.recognized", { receiptId, transactionId: txn.id });
    });
  };
}
```

**Таблица с RLS и репозиторий:**

```ts
// modules/receipts/infrastructure/db/schema.ts
export const receipts = userOwnedTable("receipts", {   // добавляет household_id, user_id, created_at + политику RLS
  id: idColumn(),                                      // uuidv7()
  status: text({ enum: RECEIPT_STATUSES }).notNull(),
  uid: text(),                                         // УИ, 24 символа
  totalMinor: bigint({ mode: "number" }),
  transactionId: uuid().references(() => transactions.id), // единственный разрешённый межмодульный импорт: schema → schema
});

// modules/receipts/infrastructure/db/receipts.repo.ts
export function createReceiptsRepo() {
  return {
    async getForRecognition(id: ReceiptId) {
      const [row] = await tx().select().from(receipts).where(eq(receipts.id, id)); // tx() — текущая транзакция
      if (!row) throw new AppError("NOT_FOUND", { entity: "receipt" });          // чужой чек тоже «не найден»
      return toDraft(row);
    },
  };
}
```

**Тонкий обработчик, задача, инструмент агента:**

```ts
// modules/receipts/api/router.ts — проверили → вызвали сценарий. Ни SQL, ни правил тут нет.
export const receiptsRouter = (uc: ReceiptsUseCases) => ({
  upload: authed.receipts.upload.handler(({ input, context }) => uc.upload(context.scope, input.files)),
  get: authed.receipts.get.handler(({ input, context }) => uc.get(context.scope, input.id)),
});

// modules/receipts/jobs/recognize.job.ts — в полезной нагрузке только идентификаторы (03, OBS-04)
export const recognizeJob = (recognize: RecognizeReceipt) => defineJob({
  name: "receipts.recognize",
  payload: z.object({ receiptId: ReceiptId }),
  options: { priority: 10, retryLimit: 2, singletonKey: (p) => p.receiptId },
  handle: (ctx, p) => recognize(ctx.scope, p.receiptId),   // ctx.scope восстановлен из конверта задачи
});

// modules/receipts/agent/tools.ts
export const receiptTools = (uc: ReceiptsUseCases) => [
  defineTool({
    name: "get_receipt", toolset: "core", kind: "read",
    description: "Receipt with items, totals and validation status. Use the latest one if no id given.",
    input: z.object({ receiptId: ReceiptId.optional() }),
    output: ReceiptCard,                                       // схема карточки из contract (CHAT-04)
    execute: (ctx, input) => uc.getCard(ctx.scope, input),      // ctx.scope — из запуска агента, не из модели
  }),
];
```

### 2.4 Карта модулей (черновик `CAPABILITIES.md`)

Постоянные id (kebab-case, не переименовываются). Зависимость = «может вызвать фасад» (вниз). Обратная связь — только
событиями. Источник правды — `tooling/architecture/modules.ts`; таблица ниже генерируется из него.

**Ярус 0 — `platform/`** (не модули): config, logging, context (ALS), db (пул, роли, `uow`, `userOwnedTable`,
миграции), jobs (pg-boss, `background_job_run`, расписания с `missed: 'once'`), events (публикация в транзакции,
подписки, `LISTEN/NOTIFY`), errors, clock, blob-store, secrets (AES-256-GCM), settings (реестр «БД > env > умолчание»),
http (Hono, oRPC, заголовки, CSRF, лимиты, два порта), telemetry (pino, Langfuse/OTel), tools (`defineTool`).

**Ярус 1 — основа**

| id | SPEC | Ответственность | Зависит от |
|---|---|---|---|
| `files` | SEC-03, RCPT-11, STMT-10 | приём файлов (тип по содержимому, лимиты), хранение, выдача владельцу, удаление всех файлов пользователя | — |
| `explain` | EXPL | хранит трассы `{value, trace}` рядом с результатом, отдаёт объяснение по `traceId` (EXPL-02) | — |
| `actions` | P5, AGT-05/07, TXN-03/04, TG-07 `/undo` | журнал отменяемых действий и «ожидающие подтверждения»; реестр обработчиков отмены и подтверждения | — |
| `privacy` | PRIV | согласия (ПД, облако, Telegram) с версией текста; экспорт и удаление аккаунта через реестр «владельцев данных» | — |
| `mail` | AUTH-06, ADM-60 | SMTP, локальный ящик (страница только с localhost), тестовое письмо | — |
| `identity` | AUTH, ROLE, SEC-01/02 | Better Auth, первый запуск, код восстановления, роли, блокировка, последний админ, демо-вход | mail, privacy |
| `notifications` | NOTIF | уведомления, центр, настройки по видам и каналам, реестр каналов доставки (web, telegram) | identity |
| `llm` | LLM, NFR-04/05/25, OBS-03 | реестр моделей, адаптеры, цепочки по задачам, лимитёр, маскирование, журнал расхода, Langfuse, эмбеддинги, речь, локальные модели | privacy |
| `system` | ADM-60, NFR-24, OBS-07 | обзор фоновых задач, доступ из сети, резервная копия, статус Langfuse | — |

**Ярус 2 — данные и знания**

| id | SPEC | Ответственность | Зависит от |
|---|---|---|---|
| `profile` | PROF | факты (анкета, чат, выводы системы), «Что ассистент знает обо мне»; принимает факты от других модулей | identity |
| `fx-rates` | STMT-09 | курсы НБРБ, кэш, эквивалент в BYN с трассой | explain |
| `merchants` | STMT-06, CAT-03, RCPT-15 | очистка названий, справочник контрагентов РБ, алиасы, нечёткое сравнение, нормализация товаров | llm |
| `categories` | CAT | категории, правила, гибридная категоризация (правила → справочник → модель пакетами) | merchants, llm |
| `accounts` | STMT-01/02 | счета, «Наличные», остатки и дата остатка | fx-rates |
| `transactions` | TXN, FIN-01 | операции, разбивка по категориям, переводы/возвраты, предварительные, сопоставление чек↔выписка, массовые действия, агрегации | accounts, categories, merchants, fx-rates, actions, explain, notifications |
| `statements` | STMT | импорт: чтение PDF/XLSX/CSV/сканов, стратегии разбора, запоминание форматов, дубли, типы, предпросмотр, откат | files, accounts, transactions, categories, merchants, fx-rates, llm, actions, notifications |
| `receipts` | RCPT | чеки: распознавание, валидатор, перепроверка, QR, дубли, правка | files, transactions, categories, merchants, llm, actions, notifications, explain |
| `recurring` | REC | поиск регулярных, ожидаемые даты, «возможно прекращён», подписки | transactions, categories, profile, notifications |
| `legal-base` | LAW | каталог, загрузчик pravo.by, редакции, фрагменты, гибридный поиск, публичная «База законов» | llm, notifications |
| `norm-tables` | TAX-03, CAL-02, AFF-05, LAW-33, ADM-11 | таблицы «параметр → период → значение → источник» с подтверждением человеком: ставки, сроки налогов, пределы ПДН | legal-base, notifications |
| `legal-consult` | LEGAL | метки цитат `[[F12.2]]`, проверка дословности, чек-листы документов и их состояние, «в моей базе нет» | legal-base |

**Ярус 3 — расчёты и представления**

| id | SPEC | Ответственность | Зависит от |
|---|---|---|---|
| `fin` | FIN | свободный остаток, прогноз остатка по дням | accounts, transactions, recurring, profile, explain |
| `budgets` | BUD | лимиты, цели, копилка, пороги уведомлений | accounts, transactions, categories, fin, notifications, actions, explain |
| `calendar` | CAL | события, напоминания (таблица `reminder` + тик), сроки налогов, гарантии, страховки | profile, transactions, recurring, receipts, norm-tables, notifications, actions |
| `tax` | TAX | калькулятор вычетов, найденные вычеты (TAX-20) | profile, transactions, categories, norm-tables, legal-base, legal-consult, notifications, explain |
| `afford` | AFF | три сценария покупки, безопасный платёж по ПДН | accounts, transactions, recurring, fin, budgets, calendar, norm-tables, profile, explain |
| `weekly` | WEEK | итоги недели: числа — calc, текст — модель | transactions, budgets, calendar, recurring, tax, llm, notifications, explain |
| `dashboard` | DASH | сборка главного экрана (только чтение) | accounts, transactions, fin, budgets, recurring, calendar, tax, weekly |
| `xls-export` | XLS | Excel с живыми формулами | transactions, categories, budgets, files |

**Ярус 4 — входы и оркестрация**

| id | SPEC | Ответственность | Зависит от |
|---|---|---|---|
| `voice` | VOICE | речь → текст (облако по согласию, иначе whisper.cpp) | llm |
| `agent` | AGT, SEC-10 | цикл агента, реестр инструментов и наборов, подсказки, «вне темы», проверка чисел, обработка цитат | llm, actions, profile, legal-consult |
| `chat` | CHAT | диалоги (сайт и Telegram), сообщения, поток ответа, вложения, контекст страницы, «статья изменилась» | agent, files, receipts, statements, voice, legal-base, legal-consult |
| `telegram` | TG | бот: привязка, команды, фото/файлы/голос, канал уведомлений | chat, agent, identity, privacy, notifications, actions, receipts, statements, voice, dashboard, budgets, weekly |
| `demo` | DEMO | демо-пользователь и связный набор данных (воспроизводимо, от сегодняшней даты) | identity, privacy, profile, files, accounts, transactions, receipts, categories, recurring, budgets, calendar, weekly |
| `quality` | QA-10…16 | eval-прогоны с бюджетом токенов, результаты и сравнение | llm, receipts, statements, categories, legal-base, legal-consult, agent |
| `admin` | ADM | раздел «Администрирование»: собирает admin-фасады системных модулей | identity, privacy, notifications, mail, llm, legal-base, norm-tables, system, quality |

**Порядок сборки** (по ярусам и ценности; каждая строка — законченный, проверяемый кусок):

```
бетон (раздел 7) → files, explain, actions, privacy, mail, identity, notifications, system, llm(заглушка)
→ profile, fx-rates, merchants, categories, accounts, transactions          (первый экран «Операции», ручной ввод)
→ llm(провайдеры), statements, receipts                                     (данные без ручного ввода)
→ recurring, fin, budgets, dashboard                                        (живой дашборд)
→ legal-base, norm-tables, legal-consult                                    (правовая база)
→ agent, chat, voice                                                        (ассистент)
→ tax, calendar, afford, weekly, xls-export                                 (выгода и планирование)
→ telegram, demo, quality                                                   (каналы, показ, качество)
admin — сквозной: admin-экран области X делается в задаче модуля X (код — в admin, фасад — в X)
```

### 2.5 Как модули общаются: фасад или событие

| Ситуация | Механизм | Пример |
|---|---|---|
| Нужен **результат** сейчас, зависимость **вниз**, нужна общая транзакция | вызов фасада | `receipts` → `transactions.recordFromReceipt()` в той же транзакции, что и сохранение чека |
| Нижний модуль должен «сообщить наверх» | **событие** (нижний не знает слушателей) | `transactions.changed` → `budgets` проверяет пороги 80/100 %, `recurring` пересчитывает, `tax` ищет вычеты |
| Побочный эффект, который может прийти через секунды | событие | после импорта — уведомление «импорт завершён», пересчёт регулярных |
| Модуль-«приёмник», которого зовут все | фасад нижнего яруса | `notifications.notify()`, `explain.save()`, `actions.record()`, `profile.upsertDerivedFact()` |
| Верхний модуль должен **подставить свою реализацию** вниз | **реестр** в корне композиции (инверсия) | канал доставки `telegram` для `notifications`; словарь имён из `profile` для маскирования в `llm`; обработчики «Отменить» для `actions`; «владельцы данных» для `privacy` |

Как устроены события:

- `events.publish(name, payload)` внутри `uow.run` ставит задачу pg-boss **в той же транзакции** (проверено в 03):
  нет записи — нет события, нет события — нет записи («outbox» бесплатно).
- Подписка = своя очередь `evt.<событие>.<модуль-слушатель>`; обработчики **идемпотентны** (доставка «хотя бы раз»)
  и получают в конверте `scope` + `requestId` (цепочка логов не рвётся, OBS-01).
- Полезная нагрузка — только идентификаторы и **пачки** (`{ ids: [...] }`, ≤ 1000): импорт 300 операций = одно событие,
  а не 300. Пересчёты — с `singletonKey` по домохозяйству и небольшой задержкой (схлопывание «шторма»).
- Мгновенный сигнал в браузер (прогресс, «данные изменились») — `events.progress()` / `events.changed()` →
  `NOTIFY kosht_realtime` → `api` → `events.stream` (SSE) → `invalidateQueries`. Так обновляются таблицы и после
  действий из Telegram и агента.

### 2.6 Паттерны и где именно они применяются

| Паттерн | Где | Зачем (пример) |
|---|---|---|
| **Фасад модуля** | `modules/*/facade.ts` + `index.ts` | наружу — узкий набор функций под нужды соседей; внутренности можно менять свободно |
| **Корень композиции без DI-контейнера** | `apps/server/src/main/compose.ts` | обычные функции `createXModule(deps)` по порядку `modules.ts`; зависимости видны в типах, нет «магии» декораторов |
| **Порты и адаптеры** (только внешний мир) | `application/ports.ts` модуля или `platform/*` | подмена в тестах офлайн: pravo.by → сохранённые страницы, модель → кассета, часы → FakeClock |
| **Unit of Work** | `platform/db/uow.ts` | `uow.run(scope, fn)`: транзакция + `SET LOCAL app.household_id`; вложенный вызов присоединяется; чужой `scope` внутри — ошибка |
| **Репозиторий** | `infrastructure/db/*.repo.ts` | SQL только здесь; берёт транзакцию из контекста; без неё — ошибка `NO_TRANSACTION` |
| **Реестр** | модели (БД, `llm`), провайдеры (код: id → фабрика адаптера), инструменты агента, наборы инструментов, каналы уведомлений, обработчики отмены/подтверждения, владельцы данных, настройки, задачи, карточки чата (фронт) | новое добавляется записью, а не правкой ядра: новая модель — строка в админке, дипломный инструмент — новый `defineTool` |
| **Стратегия** | разбор выписок: читатели по виду файла (`pdf`, `xlsx`, `xls`, `csv`, `scan`) и определители колонок (`RememberedFormat` → `Heuristic` → `LlmColumnMapping`) | новый формат = новая стратегия; запомненный формат (STMT-05) пропускает модель |
| **Цепочка ответственности** | категоризация (пользовательские правила → глобальные → MCC → модель пакетами); цепочка провайдеров с размыкателем | от дешёвого к дорогому, источник ответа сохраняется (CAT-03, «Откуда эта цифра?») |
| **Ожидающее действие** | `actions` + инструменты `kind: "destructive"` | модель не может удалить: она создаёт предложение, удаляет код после «Да» (веб и Telegram — одна функция, 04) |
| **Типизированные ошибки** | `platform/errors` + каталог в `contract` | `throw new AppError("RECEIPT_DUPLICATE", {...})` → в oRPC код 409 с `requestId`; в инструменте агента → `{ ok:false, code }` |
| **Конфигурация в два слоя** | `platform/config` (env через Zod, падение при старте) + `platform/settings` (реестр в БД) | адрес БД — из env; SMTP, ключи, часовой пояс — из админки (NFR-16: админка важнее env) |

Адаптеры внешних сервисов:

| Внешний сервис | Порт | Где адаптер | Подмена в тестах |
|---|---|---|---|
| Groq, Z.ai, llama-server (OpenAI-совместимый) | `ProviderAdapter` (реестр провайдеров) | `llm/infrastructure/providers/*` | `MockLanguageModelV4`, кассеты |
| Эмбеддинги (llama-server, bge-m3) | `Embedder` | `llm/infrastructure/embedder-llama.ts` | детерминированный «хэш-эмбеддер» |
| Речь (Groq Whisper, whisper.cpp) | `Transcriber` | `llm/infrastructure/transcribers/*` | фиксированный текст |
| NER для маскирования (~178 МБ) | `NameRecognizer` | `llm/infrastructure/masking/ner.ts` | словарный распознаватель |
| pravo.by | `LegalSource` (+ PoliteFetcher, robots) | `legal-base/infrastructure/pravo-by/` | `__fixtures__/pravo-by/*.html` |
| НБРБ | `FxRatesSource` | `fx-rates/infrastructure/nbrb.ts` | фиксированные курсы |
| Telegram Bot API | grammY внутри `telegram`; наружу — канал `DeliveryChannel` | `telegram/infrastructure/` | трансформер grammY, записывающий вызовы |
| SMTP / локальный ящик | `MailTransport` | `mail/infrastructure/{smtp,local-mailbox}.ts` | память |
| Файлы | `BlobStore` | `platform/blob-store/local-fs.ts` (`data/files/<userId>/…`) | `MemoryBlobStore` |
| Время | `Clock` (Минск, NFR-23) | `platform/clock` | `FakeClock` |
| Очередь | `Jobs` | `platform/jobs/pg-boss.ts` | `InlineJobs` (выполняет сразу) |
| QR, подготовка фото, HEIC | `QrDecoder`, `ImagePreparer` | `receipts/infrastructure/` | фикстуры |

### 2.7 Изоляция данных: `Scope` + RLS (ROLE-01, SEC-04, PRIV-07)

- **Три вида таблиц.** `userOwnedTable` (финансы, профиль, чат, файлы — RLS по `household_id`), `systemTable`
  (пользователи Better Auth, настройки, журнал расхода, задачи — без RLS), `publicTable` (законы, курсы, справочники).
- **Две роли БД.** `kosht_owner` — миграции (владелец таблиц); `kosht_app` — работа приложения (не владелец, политики
  действуют). Политика: `household_id = current_setting('app.household_id', true)::uuid` — без `Scope` строк **ноль**,
  а не «все». Drizzle 1.0 описывает это в схеме (`pgTable.withRLS`, `pgPolicy`) [В: документация Drizzle].
- **Админ** работает со своим `Scope`: прочитать чужие финансы не может ни код (правило `admin-no-user-data`), ни БД.
- **Задачи, которым нужны «все пользователи»** (тик напоминаний, итоги недели), получают только список
  `(id, household_id)` из узкой функции `SECURITY DEFINER` своего модуля, а дальше работают по одному с `Scope`.
- **Удаление аккаунта** (PRIV-06): `privacy.deleteAccount` обходит реестр «владельцев данных» (каждый модуль удаляет
  своё под `Scope` пользователя), затем папку файлов, трассы Langfuse, запись `identity`.
- **Тест-инвариант:** для каждой процедуры контракта и каждого инструмента агента пользователь A не получает данных B
  (генерируется по реестрам, а не пишется руками).

### 2.8 Ошибки, конфигурация, логи

```ts
// packages/contract/src/errors.ts — единый каталог: код → HTTP-статус, повторяемость
export const ERRORS = {
  NOT_FOUND: { status: 404 }, CONFLICT: { status: 409 }, VALIDATION: { status: 400 },
  RECEIPT_DUPLICATE: { status: 409 }, UNSUPPORTED_FILE: { status: 415 }, RATE_LIMITED: { status: 429, retryable: true },
  LLM_UNAVAILABLE: { status: 503, retryable: true }, LAW_NOT_IN_BASE: { status: 404 },
} as const satisfies Record<string, ErrorSpec>;

// в сценарии — бизнес-ошибка с параметрами (не текст!)
throw new AppError("RECEIPT_DUPLICATE", { receiptId: existing.id, uploadedOn: existing.createdOn });
```

- Одно место перевода `AppError` → ответ: перехватчик oRPC (`{ code, status, data: { requestId, params } }`),
  обёртка инструмента агента (`{ ok: false, code }` — агент сообщает и предлагает повторить, AGT-13), обёртка задачи
  (повтор, если `retryable`). Остальное — `INTERNAL` без текста исключения наружу, стек — в лог (OBS-02).
- Текст для человека — на сайте и в боте по коду: `t("errors:RECEIPT_DUPLICATE", params)` → «Этот чек уже загружен 12.10».
- Логи: pino + `AsyncLocalStorage` (`requestId`, `uid`, `source` подмешиваются сами). Сообщение — стабильный
  английский ключ события, данные — полями из белого списка: `log.info({ receiptId, ms }, "receipt.recognized")`.
  Никогда не вставлять данные в строку сообщения (redact её не видит — проверено в 08).

### 2.9 ИИ-слой: где что живёт

```
apps/server/src/modules/
├─ llm/                         единственное место, где импортируются @ai-sdk/* провайдеры
│  ├─ facade.ts                 LlmGateway: model(task, ctx) · extract() · classify() · embed() · transcribe()
│  ├─ domain/                   задачи (chat|receipt.extract|statement.columns|classify|…), возможности моделей,
│  │                            правило выбора цепочки (согласие, vision, tools) — чистые функции
│  ├─ application/
│  │  ├─ build-chain.ts         пары «провайдер+модель» по задаче и пользователю (LLM-02/10, PRIV-02)
│  │  ├─ chained-model.ts       «цепочка как одна модель» (LanguageModelV4): переключение до первого куска потока
│  │  ├─ limiter.ts             окна RPM/TPM/RPD, x-ratelimit-*, размыкатель по retry-after (LLM-05)
│  │  ├─ masking/               правила + склонённый словарь имён (порт KnownNames ← profile) + NER; демаскирование
│  │  │                         текста, потока и аргументов инструментов (04)
│  │  ├─ ledger.ts              строка журнала расхода на каждый вызов (LLM-06), без текстов
│  │  └─ local-models/          скачивание с докачкой и sha256, самотест «2+2», прогресс (NFR-25, ADM-50)
│  └─ infrastructure/           providers/, embedder, transcribers, ner, db/schema.ts (модели, цепочки, журнал, кэш)
├─ agent/                       цикл (AI SDK ToolLoopAgent), шаги ≤ 8, последний шаг без инструментов
│  ├─ application/run-agent.ts  набор инструментов (3–4 фиксированных набора — кэш префикса, 04) → модель от llm
│  ├─ application/guards/       «вне темы» и защитный классификатор (правила → эмбеддинги → малая модель),
│  │                            проверка чисел ответа (P1), постобработка цитат (через legal-consult)
│  ├─ application/tool-adapter.ts   defineTool → инструмент AI SDK: Scope из запуска, ошибки → {ok:false}
│  ├─ prompts/                  системные подсказки с версией (PROMPT_VERSION — ключ кассет и кэша eval)
│  └─ agent/tools.ts            свои инструменты: calculator (calc.expressions), chart, explain_number, page_context
└─ chat/                        хранит UIMessage.parts, процедура chat.send (поток), chat.stop, заголовки диалогов
```

**Как инструмент агента вызывает модуль, не нарушая границ.** Модуль описывает инструмент своим `defineTool` из
`platform/tools` (тип + Zod, без AI SDK). Корень композиции складывает инструменты всех модулей в реестр и отдаёт
агенту. Агент зависит только от `llm`, `actions`, `profile`, `legal-consult` — ни одного финансового модуля.

```ts
// platform/tools/define-tool.ts (набросок)
type ToolKind = "read" | "write" | "destructive";
interface ToolCtx { scope: Scope; channel: Scope["channel"]; requestId: string; page?: PageContext; undo: UndoPort; propose: ProposePort }
type ToolDef<I, O> =
  | { kind: "read" | "write"; name: string; toolset: Toolset; description: string; input: ZodType<I>; output: ZodType<O>;
      execute(ctx: ToolCtx, input: I): Promise<O> }                       // write → возвращает undoToken (AGT-05)
  | { kind: "destructive"; name: string; toolset: Toolset; description: string; input: ZodType<I>;
      propose(ctx: ToolCtx, input: I): Promise<PendingActionDraft> };     // удалить напрямую нельзя по типу (AGT-07)
```

Поток чата идёт через oRPC: сервер превращает UI-поток AI SDK в итератор событий, клиент — обратно в поток для
`useChat` (официальная интеграция oRPC с AI SDK [В: документация oRPC; точные имена функций сверить с 1.16 в бетонной
фазе]). Так у чата те же вход, проверка сессии, ошибки и `requestId`, что у остальных процедур. Ответ дописывается при
закрытой вкладке (умолчание D3): запуск агента не привязан к соединению, «Стоп» — отдельная процедура `chat.stop`.

---

## 3. Архитектура фронтенда

### 3.1 Сравнение подходов

| | А. Feature-Sliced Design полностью (app/pages/widgets/features/entities/shared) | Б. Упрощённый FSD: app → routes → features → entities → ui/lib | В. Папки по маршрутам (всё рядом с маршрутом) |
|---|---|---|---|
| Пример: карточка чека нужна на «Чеки и документы», в панели операции и в чате | `entities/receipt` | `entities/receipt` | копия в трёх маршрутах или «общая» папка без правил |
| Слоёв для запоминания | 6 + сегменты `ui/model/api/lib` + `@x`-импорты | 5, без особых импортов | 2 |
| Границы | строгие, но много церемоний | строгие, проверяемые dependency-cruiser | слабые |
| Подходит под TanStack Router (файловые маршруты) | «pages» дублируют «routes» | маршруты = тонкий слой | естественно |
| Для агентов | много решений «в какой слой» | понятно: экран → `features`, общая сущность → `entities`, вид → `ui` | быстро, но клубок через месяц |

**Выбор: Б.** Из FSD берём главное — однонаправленные слои и изоляцию фич, отказываемся от слоёв `pages/widgets`
(их роль у нас играют маршруты TanStack и фичи-экраны).

### 3.2 Структура

```
apps/web/
├─ CLAUDE.md · index.html · vite.config.ts · tsconfig.json
└─ src/
   ├─ main.tsx
   ├─ app/               провайдеры (Mantine, Query, Router, i18n), каркас: боковое меню, верхняя панель,
   │                     нижняя панель телефона, плавающая кнопка «Спросить ассистента», граница ошибок
   ├─ routes/            файловые маршруты TanStack — ТОНКИЕ: схема параметров адреса, loader, вызов страницы фичи
   │  ├─ __root.tsx
   │  ├─ _public/        login · register · recovery · laws (публичная «База законов») · policy
   │  ├─ _local/         setup (первый запуск) · mailbox (локальный ящик) — только с localhost
   │  ├─ _app/           index (дашборд) · operations · documents · accounts · recurring · budget · calendar ·
   │  │                  assistant.$dialogId · deductions · afford · memory · onboarding · settings
   │  ├─ _app/admin/     index · users · laws · rates · ai · quality · system   (beforeLoad: роль admin)
   │  └─ dev.gallery.tsx витрина компонентов и состояний (только в режиме разработки, вместо Storybook)
   ├─ features/          ЭКРАНЫ по design/SCREENS.md (у каждой — CLAUDE.md-паспорт)
   │  dashboard · operations · documents · accounts · recurring · budget · calendar · assistant · deductions ·
   │  afford · laws · memory · auth · onboarding · setup · mailbox · settings · notifications · admin/<раздел>
   ├─ entities/          общие предметные виджеты + хуки данных: transaction · receipt · category · account ·
   │                     law (чип статьи и цитата с загрузкой) · explanation («Откуда эта цифра?» с загрузкой трассы) ·
   │                     limit · goal · calendar-event · notification
   ├─ ui/                ДИЗАЙН-СИСТЕМА поверх Mantine — только представление, без запросов
   │  ├─ theme/          tokens.css (копия design/tokens.css), theme.ts, category-colors.ts, chart-colors.ts, fonts.ts
   │  └─ components/     Money · WhyButton · Formula · LawRefChip · LawQuote · StatusBadge · CategoryIcon · LimitBar ·
   │                     StatCard · EmptyState · Skeletons · Sheet · ConfirmDialog · UndoToast · PageHeader · Steps
   ├─ lib/               api (клиент oRPC + утилиты TanStack Query) · events (SSE → invalidate) · i18n ·
   │                     page-context (CHAT-08) · assistant-bridge (открыть чат с вопросом) · media · env
   └─ test/              setup.ts (matchMedia, ResizeObserver…), render-with-providers, MSW-обработчики
```

Фича изнутри:

```
features/operations/
├─ CLAUDE.md                 экран Operations.dc.html, скриншоты, TXN-01…05, TXN-10/11, CAT-05, XLS-01
├─ index.ts                  наружу: OperationsPage (для маршрута)
├─ OperationsPage.tsx        состояния: загрузка / пусто / ошибка / успех (DES-16)
├─ components/               OperationsTable · FiltersBar · BulkActionsBar · AddOperationModal
├─ model/                    search.ts (Zod-схема параметров адреса) · use-operations.ts · use-bulk-actions.ts
└─ *.test.tsx
```

### 3.3 Правила импортов

| Слой | Может импортировать | Нельзя |
|---|---|---|
| `app` | всё ниже | — |
| `routes` | `features/*/index.ts`, `lib` | `entities`, `ui` напрямую (маршрут не рисует сам) |
| `features/<x>` | своё, `entities`, `ui`, `lib` | другую фичу (связь — через адрес `Link`, `assistant-bridge`, общие сущности) |
| `entities/<x>` | `entities/*/index.ts`, `ui`, `lib` | `features`, `routes`, `app` |
| `ui` | Mantine, `lib/i18n`, `@kosht/i18n` (форматы), `@kosht/kernel` (типы) | `lib/api`, `entities`, `features` — никаких запросов |
| `lib` | `@kosht/contract`, `@kosht/kernel`, `@kosht/i18n` | слои выше |
| весь `apps/web` | `packages/contract`, `kernel`, `i18n` | `apps/server`, `packages/calc` (P1: числа считает сервер), `packages/testing` вне тестов |

### 3.4 Данные, формы, чат, i18n, тема

- **Клиент oRPC + TanStack Query.** `orpc.transactions.list.queryOptions({ input })` — ключи запросов генерирует oRPC,
  своих фабрик ключей нет. Инвалидация — по событию `changed` из `events.stream` (общий механизм для действий сайта,
  агента и бота) и после своих мутаций.
- **Адрес — состояние страницы.** У маршрута Zod-схема параметров (`period`, фильтры). Клик по «Такси» на дашборде →
  `/operations?period=2026-09&category=taxi` (DASH-03). Контекст страницы для агента (CHAT-08) собирается из маршрута,
  параметров и выбранного объекта (`usePageContext`) и проверяется схемой `PageContext` из контракта.
- **Формы** — Mantine Form + `schemaResolver` со **схемой входа процедуры из контракта**: одна схема проверяет форму и
  запрос на сервере. Сообщения ошибок — ключи i18n (Zod 4 с локалью `ru` на обеих сторонах).
- **Чат** (`features/assistant`): `useKoshtChat` (обёртка `useChat` с транспортом oRPC), реестр частей
  `{ "tool-<имя>" | "data-<вид>" → компонент }` с безопасным запасным видом, потоковый Markdown (react-markdown +
  remend + мемо-блоки, 11), метки `[[F12.2]]` → `LawRefChip` → `LawQuote`, шаги, `aria-live` только на вехах. Панель
  (`Drawer`) — в каркасе `app`, на телефоне — полноэкранный маршрут. Карточки переиспользуют `entities/*`.
- **i18n**: i18next, пространства имён по фичам (`operations`, `assistant`…) + `common`, `errors`, `formulas`
  (подписи трасс EXPL). Литералов в JSX нет — проверка в `make check`.
- **Тема**: `ui/theme/tokens.css` = `design/tokens.css` один в один; тема Mantine ссылается на `var(--brand)` и т. д.;
  цвета категорий и графиков — таблицы в `ui/theme` по кодам базовых категорий. Шрифты Onest/Literata — `@fontsource-variable`.
- **Базовые компоненты** (по `kit.css`/`DESIGN.md`, раздел 4): `Money` (формат DES-17, табличные цифры, знак и цвет
  дохода), `WhyButton` (ⓘ с `aria-label` «Откуда эта цифра: свободный остаток»), `Formula`, `LawRefChip`, `LawQuote`
  (Literata, «Редакция на …», pravo.by), `StatusBadge` (иконка обязательна — проп без иконки не скомпилируется),
  `LimitBar` (до 80 % хвоя, 80–99 % внимание + треугольник, ≥ 100 % риск + «!»), `EmptyState`, скелетоны, `Sheet`,
  `ConfirmDialog` (кнопка — глагол: «Да, перенести 13»), `UndoToast`.

Пример маршрута и фичи:

```tsx
// routes/_app/operations.tsx — тонкий
export const Route = createFileRoute("/_app/operations")({
  validateSearch: OperationsSearch,                                   // features/operations/model/search.ts
  staticData: { page: "operations" },                                 // для контекста страницы (CHAT-08)
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(orpc.transactions.list.queryOptions({ input: toListInput(deps) })),
  component: () => <OperationsPage search={Route.useSearch()} />,
});

// features/operations/components/OperationRow.tsx
export function OperationRow({ op }: { op: TransactionListItem }) {
  const { t } = useTranslation("operations");
  return (
    <Table.Tr>
      <Table.Td><LocalDateText value={op.date} /></Table.Td>
      <Table.Td>{op.counterparty}</Table.Td>
      <Table.Td><CategoryBadge category={op.category} /></Table.Td>          {/* entities/category */}
      <Table.Td ta="right">
        <Money value={op.amount} kind={op.type} tabular />                  {/* ui: формат и цвет по токенам */}
        <WhyNumber traceId={op.amountTraceId} label={t("amountWhy")} />    {/* entities/explanation */}
      </Table.Td>
    </Table.Tr>
  );
}
```

---

## 4. Правила границ для dependency-cruiser (черновик конфигурации)

Конфигурация **генерируется** из карты модулей: добавили модуль или зависимость в `modules.ts` — правила обновились.
Проверено на макете дерева (48 файлов) для ядра правил — `no-circular`, `web-not-to-server`, запрет `calc` на фронте,
`module-public-api-only`, `schema-to-schema-only`, `deps-of-*`, `admin-no-user-data`, `platform-not-to-modules`,
`domain-is-pure`, `calc-only-kernel`, `drizzle-only-in-infrastructure`, `ai-providers-only-in-llm`,
`web-feature-isolation`, `web-layers-down`, `ui-is-presentational`, `not-to-unresolvable`: подложенные 16 нарушений
пойманы все, разрешённые связи (фасад вниз, `schema.ts → schema.ts` для внешнего ключа, фича → сущность, `agent` → `ai`)
— без ложных срабатываний [В, dependency-cruiser 18.7.0 + typescript 6; импорт `modules.ts` из `.mjs` работает в
Node 24 без сборки]. Остальные правила ниже написаны по тому же образцу, но **не прогонялись** [Н] — для них в шаге 2
«бетонной» фазы нужны свои фикстуры нарушений.

```js
// .dependency-cruiser.mjs
import { MODULES } from "./tooling/architecture/modules.ts";
const M = "^apps/server/src/modules", W = "^apps/web/src";
const ids = MODULES.map((m) => m.id);
const USER_DATA = MODULES.filter((m) => m.userData).map((m) => m.id);   // финансы, профиль, чат, файлы…

// «Модуль X может зависеть только от своего списка dependsOn» — одно правило на модуль
const perModule = MODULES.flatMap((m) => {
  const others = ids.filter((id) => id !== m.id && !m.dependsOn.includes(id));
  return others.length ? [{
    name: `deps-of-${m.id}`, severity: "error",
    comment: `${m.id} может зависеть только от: ${m.dependsOn.join(", ") || "—"} (tooling/architecture/modules.ts)`,
    from: { path: `${M}/${m.id}/` }, to: { path: `${M}/(${others.join("|")})/` },
  }] : [];
});

export default {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },

    // Фронт ↔ сервер: только через пакеты
    { name: "web-not-to-server", severity: "error", from: { path: "^apps/web/" }, to: { path: "^apps/server/" } },
    { name: "server-not-to-web", severity: "error", from: { path: "^apps/server/" }, to: { path: "^apps/web/" } },
    { name: "web-only-shared-packages", severity: "error", comment: "P1: числа считает сервер; тест-код — только в тестах",
      from: { path: "^apps/web/", pathNot: "\\.test\\.tsx?$" }, to: { path: "^packages/(calc|testing)/" } },

    // Модули сервера
    { name: "module-public-api-only", severity: "error",
      comment: "В чужой модуль — только через index.ts (исключение: schema.ts → schema.ts для внешних ключей)",
      from: { path: `${M}/([^/]+)/`, pathNot: `${M}/[^/]+/infrastructure/db/schema\\.ts$` },
      to: { path: `${M}/([^/]+)/`, pathNot: [`${M}/$1/`, `${M}/[^/]+/index\\.ts$`] } },
    { name: "schema-to-schema-only", severity: "error",
      from: { path: `${M}/([^/]+)/infrastructure/db/schema\\.ts$` },
      to: { path: `${M}/([^/]+)/`, pathNot: [`${M}/$1/`, `${M}/[^/]+/infrastructure/db/schema\\.ts$`] } },
    ...perModule,                                                     // «только вниз и только из списка»
    { name: "admin-no-user-data", severity: "error", comment: "PRIV-07: админка не видит финансы, профиль и переписку",
      from: { path: `${M}/admin/` }, to: { path: `${M}/(${USER_DATA.join("|")})/` } },
    { name: "platform-not-to-modules", severity: "error",
      from: { path: "^apps/server/src/platform/" }, to: { path: `${M}/` } },
    { name: "domain-is-pure", severity: "error",
      from: { path: `${M}/[^/]+/domain/` },
      to: { path: [`${M}/[^/]+/(application|infrastructure|api|jobs|agent|subscriptions)/`, "^apps/server/src/platform/"] } },
    { name: "api-thin", severity: "error", comment: "обработчики зовут сценарии, а не репозитории",
      from: { path: `${M}/[^/]+/(api|agent|jobs)/` }, to: { path: `${M}/[^/]+/infrastructure/db/` } },
    { name: "infrastructure-not-to-application", severity: "error",
      from: { path: `${M}/[^/]+/infrastructure/` }, to: { path: `${M}/[^/]+/(application|api)/`, pathNot: "/ports\\.ts$" } },

    // Пакеты
    { name: "kernel-only-zod", severity: "error",
      from: { path: "^packages/kernel/" }, to: { pathNot: ["^packages/kernel/", "node_modules/zod/"] } },
    { name: "calc-only-kernel", severity: "error", comment: "calc чист: без БД, сети, файлов",
      from: { path: "^packages/calc/" }, to: { pathNot: ["^packages/(calc|kernel)/", "node_modules/@kosht/(calc|kernel)"] } },
    { name: "contract-only-schemas", severity: "error",
      from: { path: "^packages/contract/" },
      to: { pathNot: ["^packages/(contract|kernel)/", "node_modules/(zod|@orpc/contract)/", "node_modules/@kosht/kernel"] } },

    // Внешние библиотеки — в отведённых местах
    { name: "drizzle-only-in-infrastructure", severity: "error",
      from: { path: "^apps/server/", pathNot: [`${M}/[^/]+/infrastructure/`, "^apps/server/src/platform/db/"] },
      to: { path: "node_modules/drizzle-orm/" } },
    { name: "ai-providers-only-in-llm", severity: "error",
      from: { pathNot: `${M}/llm/` }, to: { path: "node_modules/@ai-sdk/(?!react)" } },
    { name: "ai-core-only-in-llm-agent-chat", severity: "error",
      from: { path: "^apps/server/", pathNot: `${M}/(llm|agent|chat)/` }, to: { path: "node_modules/ai/" } },
    { name: "pg-boss-only-in-platform", severity: "error",
      from: { pathNot: "^apps/server/src/platform/jobs/" }, to: { path: "node_modules/pg-boss/" } },
    { name: "grammy-only-in-telegram", severity: "error",
      from: { pathNot: `${M}/telegram/infrastructure/` }, to: { path: "node_modules/grammy/" } },
    { name: "orpc-server-only-in-api", severity: "error",
      from: { path: "^apps/server/", pathNot: [`${M}/[^/]+/api/`, "^apps/server/src/(platform/http|main)/"] },
      to: { path: "node_modules/@orpc/server/" } },
    { name: "ai-react-only-in-assistant", severity: "error",
      from: { path: "^apps/web/", pathNot: `${W}/features/assistant/` }, to: { path: "node_modules/@ai-sdk/react/" } },

    // Слои фронта
    { name: "web-feature-isolation", severity: "error",
      from: { path: `${W}/features/([^/]+)/` }, to: { path: `${W}/features/([^/]+)/`, pathNot: `${W}/features/$1/` } },
    { name: "web-layers-down", severity: "error", comment: "app → routes → features → entities → ui, lib",
      from: { path: `${W}/(entities|ui|lib)/` }, to: { path: `${W}/(app|routes|features)/` } },
    { name: "web-routes-thin", severity: "error",
      from: { path: `${W}/routes/` }, to: { path: [`${W}/(entities|ui)/`, `${W}/features/[^/]+/(?!index\\.ts$)`] } },
    { name: "ui-is-presentational", severity: "error",
      from: { path: `${W}/ui/` }, to: { path: [`${W}/(entities|lib/api|lib/events)/`] } },

    // Общее
    { name: "no-test-code-in-prod", severity: "error",
      from: { pathNot: "(\\.test\\.tsx?$|\\.int\\.test\\.ts$|^e2e/|^packages/testing/)" },
      to: { path: "(\\.test\\.tsx?$|^packages/testing/)" } },
    { name: "not-to-unresolvable", severity: "error", from: {}, to: { couldNotResolve: true } },
    { name: "not-to-dev-dep", severity: "error",
      from: { path: "^(apps|packages)/[^/]+/src", pathNot: "\\.test\\." }, to: { dependencyTypes: ["npm-dev"] } },
    { name: "no-orphans", severity: "warn",
      from: { orphan: true, pathNot: "(entrypoints/|\\.config\\.|\\.d\\.ts$|routes/)" }, to: {} },
  ],
  options: {
    parser: "tsc", tsConfig: { fileName: "tsconfig.json" },                     // + typescript@6 через packageExtensions (01)
    doNotFollow: { path: "node_modules" }, exclude: { path: "(^|/)(node_modules|dist|coverage)/" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "node", "default"],
                              extensions: [".ts", ".tsx", ".js", ".mjs", ".json"] },
    cache: { folder: "node_modules/.cache/dependency-cruiser", strategy: "metadata" },
  },
};
```

**Страховка «0 модулей»** (проверена: пустой граф → код 2, неразрешённые импорты → код 1):

```js
// tooling/checks/deps-guard.mjs — запуск: depcruise apps packages e2e --config -T json | node tooling/checks/deps-guard.mjs
const r = JSON.parse(readFileSync(0, "utf8"));
const n = r.summary.totalCruised, min = Number(process.env.MIN_MODULES ?? 200);
if (n < min) { console.error(`deps-guard: проверено ${n} файлов (< ${min}) — граф пуст, проверка границ не работает`); process.exit(2); }
const unresolved = r.modules.flatMap((m) => m.dependencies.filter((d) => d.couldNotResolve));
process.exit(r.summary.error > 0 || unresolved.length > 0 ? 1 : 0);
```

Дополнительно в `tooling/architecture/fixtures/` — маленькое дерево с **намеренными** нарушениями (по одному на
правило) и тест «каждое правило ловит своё нарушение»: правило с ошибкой в регулярном выражении иначе молча ничего
не проверяет. Порядок сборки в `compose.ts` сверяется тестом с топологической сортировкой `modules.ts`.

Чего dependency-cruiser не видит (закрывается другими проверками в `make check`): `Date.now()`/`Math.random()` в `calc`
(`tooling/checks/calc-no-clock.mjs` или `no-restricted-globals` Oxlint — проверить поддержку), «сырые» цвета
(`no-raw-colors.mjs`: `#hex`, `rgb(` вне `ui/theme`), литералы в JSX (правило Oxlint, если есть, иначе свой скрипт),
вызов модели внутри транзакции (проверка во время выполнения в `LlmGateway`).

---

## 5. Конвенции кода

### 5.1 Именование

| Что | Как | Пример |
|---|---|---|
| Файлы и папки | kebab-case; React-компоненты — PascalCase | `recognize-receipt.ts`, `OperationRow.tsx` |
| Идентификаторы в коде | английские; типы PascalCase, функции camelCase | `freeBalance`, `ReceiptsFacade` |
| Id модулей | kebab-case из `modules.ts` | `legal-base`, `xls-export` |
| Сценарий | глагол-объект, фабрика `make…` | `makeRecognizeReceipt` → `recognizeReceipt(scope, id)` |
| Таблицы БД | snake_case, множественное число | `receipt_items`, `fragment_versions` |
| События | `<модуль>.<прошедшее время>` | `transactions.changed`, `receipts.recognized` |
| Задачи pg-boss | `<модуль>.<глагол>` | `receipts.recognize`, `law.daily-check` |
| Коды ошибок | SCREAMING_SNAKE | `RECEIPT_DUPLICATE` |
| Инструменты агента | snake_case, описание на английском (экономия токенов, 04) | `search_transactions` |
| Ключи i18n | `<ns>:<экран>.<ключ>` | `operations:bulk.confirmTitle` |
| Сообщения логов | стабильный ключ события | `"receipt.recognized"` |
| Экспорт | только именованный (исключение — то, что требует инструмент) | `export function …` |
| Импорты | относительные с `.ts`; пакеты — `@kosht/*`; без алиасов `@/` (Node их не понимает, 01) | `../domain/receipt.ts` |

### 5.2 Язык

Комментарии, `CLAUDE.md`, правила, ADR, коммиты, тексты интерфейса — **на русском**. Идентификаторы, коды ошибок,
имена событий, ключи логов, описания инструментов агента — **английские** (это «машинные» имена). Комментарий
объясняет «почему» и ссылается на требование: `// RCPT-10: без пары — предварительная, остаток не меняет`.

### 5.3 Данные и время

- Деньги — `Money { minor, currency }` в целых копейках; проценты и ставки — целые базисные пункты или десятичные строки
  с явным округлением в `calc`. `float` для денег запрещён.
- Календарный день — `LocalDate` (`"2026-10-21"`, по Минску), момент — ISO UTC. «Сегодня» — только из `Clock`.
- Идентификаторы — `uuidv7()`, в TypeScript — бренды (`ReceiptId`), чтобы нельзя было перепутать id чека и операции.
- DTO контракта ≠ строка БД: явное преобразование `toDto()` в модуле.

### 5.4 Обязательные «нельзя» (ревьюер проверяет строго)

- Вызов модели, HTTP или чтение файла **внутри** `uow.run` (держит транзакцию секундами).
- `userId` в аргументах инструмента агента или в теле запроса как «чьи данные» — только `Scope` из входа.
- Число в тексте ответа, которого нет в результатах инструментов (P1).
- Текст переписки, суммы с привязкой к пользователю, содержимое документов — в логах и в полезной нагрузке задач.
- Цвет, шрифт, отступ «магическим» значением во фронте: только токены темы (`var(--warn)`, `theme.spacing`).
- Текст интерфейса литералом — только `t()`.
- Подавление проверок (`// oxlint-disable`, `@ts-expect-error`, `.skip`) без ссылки на задачу и причину.

### 5.5 Тесты: где лежат и какой уровень для чего

| Уровень | Что | Где | Инструмент |
|---|---|---|---|
| Unit | весь `calc` (все примеры TAX-07, КП AFF/BUD/REC), `domain/` модулей, нормализация цитат, маскирование | рядом: `*.test.ts` | Vitest, свойства — fast-check [Н] |
| Интеграционный | сценарии модулей + репозитории + RLS на **настоящем** Postgres (шаблонная БД на файл, ~20 мс — 03); разбор выписок на `datasets/statements`; разборщик pravo.by на `__fixtures__` | рядом: `*.int.test.ts` | Vitest + `@kosht/testing/db` |
| Контрактный | роутер ↔ контракт в процессе (`createRouterClient`): проверка входа, коды ошибок, требование входа; «A не видит B» по всем процедурам | `apps/server/src/main/*.contract.test.ts` | Vitest |
| Агент | сценарии на кассетах: ожидаемые инструменты, числа из результатов, подтверждения, локальный режим | `modules/agent/**/*.agent.test.ts`, кассеты рядом | Vitest + `ReplayModel` |
| Компонентный | `ui`, карточки чата, формы, состояния DES-16 | рядом: `*.test.tsx` | Vitest + Testing Library + MSW |
| E2E | 5–8 сценариев (первый запуск, чек, импорт, чат, вычет, экспорт) + axe на всех маршрутах 1440/390 | `e2e/specs/*.spec.ts` | Playwright, сервер в режиме кассет |
| Архитектурный | границы, «0 модулей», фикстуры нарушений, порядок композиции, сырые цвета, литералы | `tooling/` | dependency-cruiser + скрипты |
| Eval (не в `make test`) | QA-11…15 на реальных моделях | `modules/quality`, `datasets/` | `make eval` |

Сообщение теста — человеческое: `it("чек 3 × 2,49 = 8,47 не сходится и называет строку 2")`.

---

## 6. Правила для агентов (rulesets)

### 6.1 Какие файлы и что в них

| Файл | Когда грузится | Содержание (до …строк) |
|---|---|---|
| `/CLAUDE.md` | всегда | что за проект, карта папок, команды `make`, конвейер, язык, «не выдумывать результаты», ссылки на ARCHITECTURE/CAPABILITIES (≤ 100) |
| `apps/server/CLAUDE.md` | при работе в сервере | корень композиции, как добавить модуль (`make new-module`), процессы, Scope/uow (≤ 60) |
| `apps/server/src/platform/CLAUDE.md` | в платформе | что здесь живёт и что сюда **нельзя** приносить (бизнес) (≤ 40) |
| `apps/server/src/modules/<id>/CLAUDE.md` × 36 | в модуле | паспорт (шаблон 6.3) (≤ 60) |
| `apps/web/CLAUDE.md` | во фронте | слои, правила импортов, состояния, сверка с макетом 1440/390 (≤ 60) |
| `apps/web/src/ui/CLAUDE.md` | в дизайн-системе | список компонентов, правила токенов, доступность (≤ 50) |
| `apps/web/src/features/<экран>/CLAUDE.md` | в фиче | паспорт экрана: файл макета, скриншоты, требования SPEC, переходы (≤ 30) |
| `packages/{kernel,calc,contract,i18n,testing}/CLAUDE.md` | в пакете | назначение, запреты, как тестировать (≤ 40) |
| `e2e/CLAUDE.md`, `tooling/CLAUDE.md` | там же | как запускать, как добавлять сценарий/проверку (≤ 30) |

`.claude/rules/*.md` (сквозные темы, `paths:`), каждое ≤ 40–60 строк:

| Файл | `paths` | О чём |
|---|---|---|
| `backend-module.md` | `apps/server/src/modules/**` | устройство модуля, фасад, сценарии, события (полный текст ниже) |
| `database.md` | `**/infrastructure/db/**`, `apps/server/drizzle/**`, `apps/server/src/platform/db/**` | схемы, RLS, миграции (ниже) |
| `frontend-feature.md` | `apps/web/src/{features,entities,routes}/**` | экраны, данные, формы (ниже) |
| `ui-design-system.md` | `apps/web/src/ui/**`, `apps/web/**/*.css` | токены, компоненты по `kit.css`, доступность |
| `calc.md` | `packages/calc/**` | чистота, трасса, копейки, округление, тесты-примеры SPEC |
| `contract.md` | `packages/contract/**` | только добавление полей, `deprecated`, ошибки из каталога, DTO ≠ БД |
| `agent-tools.md` | `**/agent/tools.ts`, `apps/server/src/modules/agent/**` | `defineTool`, виды read/write/destructive, компактные результаты, наборы, описания на английском |
| `llm-calls.md` | `apps/server/src/modules/llm/**`, `**/*.prompt.ts`, `**/*extraction*.ts` | только через шлюз, не в транзакции, данные документа — блоком `<document>`, версия подсказки |
| `jobs-events.md` | `**/jobs/**`, `**/subscriptions/**`, `**/events.ts` | идемпотентность, только id в нагрузке, пачки, singletonKey, ночное окно |
| `testing.md` | `**/*.test.ts{,x}`, `**/*.int.test.ts`, `e2e/**` | уровни, кассеты, без интернета, понятные сообщения, запрет `.skip` |
| `i18n.md` | `packages/i18n/**`, `apps/web/**/*.tsx`, `modules/{telegram,mail,notifications}/**` | ключи, множественные числа, форматы DES-17 |
| `security-privacy.md` | `modules/{identity,privacy,files,mail}/**`, `apps/server/src/platform/{http,secrets,telemetry}/**` | секреты, логи без ПД, localhost-only, загрузка файлов |

Источник правды по границам — `.dependency-cruiser.mjs` и `modules.ts`; правила объясняют **почему** и ссылаются на них,
не копируя списки (копия протухнет). В промпте каждой роли конвейера: «до работы прочитай `CLAUDE.md` каждого
затронутого модуля и `Glob .claude/rules/*.md`» — ленивая загрузка не срабатывает на одном Grep (09).

### 6.2 Шаблон паспорта модуля (`modules/<id>/CLAUDE.md`)

```markdown
# Модуль `receipts` — чеки

<!-- Паспорт ≤ 60 строк. Обновляется в том же коммите, что меняет публичный API, зависимости или запреты. -->

## Назначение
Распознаёт фото кассовых чеков в позиции, проверяет арифметику, сохраняет чек сразу и создаёт операцию
(или предварительную операцию до выписки). Одна фраза «зачем»: покупки учитываются без ручного ввода.

## Требования SPEC
RCPT-01…15 (основное), TXN-10 (сопоставление — делает `transactions`, мы вызываем), CAT-04, CAL-04 (события
гарантии — делает `calendar` по нашему событию), PRIV-04, SEC-03, SEC-11, DES-03. Макет: Documents.dc.html, MobileScan.dc.html.

## Публичный API (`index.ts`)
- `createReceiptsModule(deps)` — фабрика для корня композиции.
- Фасад `ReceiptsFacade`: `getCardForTransaction(scope, txnId)`, `getWarrantyItems(scope, itemIds)`.
- Контракт: `contract.receipts.*` (upload, get, list, updateItems, confirm, cancel).
- События: `receipts.recognized {receiptId, transactionId}`, `receipts.needs-review {receiptId}`,
  `receipts.warranty-items-found {itemIds}`.
- Задачи: `receipts.recognize`. Инструменты агента: `get_receipt`, `receipt_status` (набор `core`).
- Владелец данных: таблицы `receipts`, `receipt_items`, файлы вида `receipt-photo`.

## Зависимости
Можно: files, transactions, categories, merchants, llm, actions, notifications, explain (список — `modules.ts`).
Слушает: `transactions.merged`.

## Запреты
- Не создавать и не менять операции SQL-ом — только `transactions` через фасад.
- Модель — только через `llm` и только вне `uow.run`; текст чека — данные, не инструкции (SEC-11).
- Числа (валидатор, итоги) — только `calc.validateReceipt`; модель не «досчитывает».
- Сервис МНС «Проверка чека» автоматически не запрашивать (RCPT-12, reCAPTCHA).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/receipts` — unit + int (нужен `make db-up`).
- Кассеты: `__cassettes__/`; перезапись — `make ai-record SCENARIO=receipts/*` (нужны ключи, тратит лимиты).
- Ключевые сценарии: дубль по УИ; перепроверка исправила строку → «сходится»; карта без выписки → предварительная.

## Подводные камни
- HEIC декодируется в воркере (~360 МБ на 12 Мп) — не в `api`.
- Распознавание на iGPU по Vulkan даёт мусор: mmproj на CPU (05).
```

Шаблон паспорта фичи короче: экран и файлы макета (`design/screens/…`, `screenshots/desktop|mobile-width|states/…`),
требования SPEC, процедуры контракта, состояния, переходы, отличия от макета (с причиной).

### 6.3 Сквозные правила целиком

**`.claude/rules/backend-module.md`**

```markdown
---
paths:
  - "apps/server/src/modules/**"
---
# Модуль сервера

Карта и зависимости — `tooling/architecture/modules.ts` (проверяет `make deps-check`). Паспорт — `CLAUDE.md` модуля.

- Наружу модуль виден только через `index.ts`: фабрика `create<Id>Module` и типы фасада. В чужой модуль —
  только через его `index.ts` и только если он есть в `dependsOn`. Нужна новая зависимость — правка `modules.ts`
  в той же задаче с обоснованием; зависимость вверх запрещена — используй событие или реестр.
- Раскладка: `domain/` чистое (без БД, сети, времени, платформы) · `application/` сценарий = файл, фабрика
  `make<Сценарий>(deps)` → `(scope, input)` · `infrastructure/` SQL и адаптеры · `api/` тонкие обработчики ·
  `jobs/` · `subscriptions/` · `agent/tools.ts`.
- Первый аргумент сценария и фасада — `scope: Scope`. Никогда не брать «чей пользователь» из входных данных.
- Транзакции открывает сценарий: `platform.uow.run(scope, fn)`. Внутри — только БД, `events.publish`, фасады
  соседей. Модель, HTTP, файлы — между транзакциями.
- Числа — только `@kosht/calc`, результат с трассой сохраняй через `explain`, если число показывается пользователю.
- Ошибки — `throw new AppError(КОД, params)`; код из `packages/contract/src/errors.ts`, новый код — туда же
  + текст в `packages/i18n/.../errors`. Не бросай строки и `Error` с текстом для пользователя.
- Сообщить наверх — `events.publish(имя, { ids })` (схема в `events.ts`), подписчики идемпотентны.
- Одиночное изменяющее действие регистрирует отмену в `actions`; удаление и массовое — только «ожидающее действие».
- Логи: `log.info({ receiptId }, "receipt.recognized")` — ключ события + id; без текстов, сумм, ПД.
- Тест на каждый сценарий: `*.int.test.ts` на реальной БД; чистые правила — `*.test.ts`. Изменил публичный API,
  зависимости, события или запреты — обнови паспорт в том же коммите.
```

**`.claude/rules/database.md`**

```markdown
---
paths:
  - "apps/server/src/modules/*/infrastructure/db/**"
  - "apps/server/src/platform/db/**"
  - "apps/server/drizzle/**"
---
# База данных (PostgreSQL 18, Drizzle 1.0 RC — точная версия)

- Таблица принадлежит одному модулю и объявляется в его `infrastructure/db/schema.ts`. Читать и писать чужие
  таблицы нельзя — только фасад модуля-владельца. Импорт чужого `schema.ts` — только ради `references()`.
- Данные пользователя — только `userOwnedTable(...)`: он добавляет `household_id`, `user_id`, `created_at`,
  `updated_at` и политику RLS. Системные — `systemTable`, справочники и законы — `publicTable`. Выбор вида — в паспорте.
- Деньги — `bigint` копеек (`mode: "number"`) + `currency`; дни — `date`; моменты — `timestamptz`; id — `uuid`
  с `uuidv7()`. Никаких `real/double` для денег.
- Запросы — построителем (`select/insert/update`) и `sql\`\``; реляционный API `db.query.*` не использовать
  (меняется между версиями Drizzle, 03). Только параметры, никакой склейки строк.
- Репозиторий берёт транзакцию из контекста (`tx()`), не открывает свою и не принимает `userId`.
- Миграции: `make db-generate` → прочитать SQL глазами (индексы HNSW, политики, `CONCURRENTLY` пишутся руками)
  → закоммитить вместе со схемой. Откатов нет: для разработки — `make db-reset`. Расширения (`vector`, `pg_trgm`) —
  в первой ручной миграции.
- Таблицы pg-boss Drizzle не трогает (`schemaFilter: ["public"]`).
- Новая пользовательская таблица ⇒ (1) её строки входят в экспорт и удаление модуля (реестр владельцев данных),
  (2) тест «пользователь A не видит строку B» проходит, (3) `make check` зелёный.
- Индексы — под реальные запросы сценариев; частичные индексы по `is_current` для версий фрагментов (LAW-31).
```

**`.claude/rules/frontend-feature.md`**

```markdown
---
paths:
  - "apps/web/src/features/**"
  - "apps/web/src/entities/**"
  - "apps/web/src/routes/**"
---
# Экран и фича сайта

- Начни с паспорта фичи: файл макета `design/screens/<Экран>.dc.html`, скриншоты 1440 и 390, состояния
  `design/screenshots/states/<Экран>--*.png`, требования SPEC. Внешний вид — по макету, поведение — по SPEC;
  намеренное отличие от макета запиши в отчёт задачи.
- Слои: routes (тонкие) → features → entities → ui, lib. Фича не импортирует другую фичу: переход — `Link`
  с типизированными параметрами, вопрос ассистенту — `lib/assistant-bridge`, общий виджет — в `entities`.
- Данные — только через `orpc.<процедура>.queryOptions/mutationOptions` из `lib/api`. Числа не считать на
  клиенте (P1): сумма, процент, остаток приходят с сервера вместе с `traceId` для «Откуда эта цифра?».
- Состояние страницы (период, фильтры, открытая карточка) — в адресе, схема Zod в `model/search.ts`.
- Формы — Mantine Form + `schemaResolver(<схема входа из @kosht/contract>)`; ошибки сервера — по коду через
  `t("errors:КОД", params)`.
- Каждый экран: загрузка (скелетон той же формы), пусто (что здесь будет и 1–3 первых шага), ошибка (что случилось
  и что сделать), успех (DES-16). Одиночное действие — сразу и `UndoToast`; удаление и массовое — `ConfirmDialog`.
- Только компоненты `ui/` и Mantine; цвета, отступы, радиусы — токены темы. Суммы — `<Money>`, у каждого числа —
  `WhyNumber`. Статус всегда с иконкой или текстом, не только цветом.
- Тексты — только `t()` в пространстве имён фичи; множественные числа — через i18next.
- Доступность: настоящие `button`/`a`/`label`, `aria-label` у иконок, Esc закрывает панели, фокус возвращается.
- Готово, когда: компонентные тесты состояний зелёные, axe 0 нарушений на 1440 и 390, нет горизонтальной прокрутки,
  скриншоты сверены с макетом.
```

---

## 7. «Бетонная» фаза: что появляется до первой бизнес-функции

Цель — чтобы первая задача «Операции» сводилась к «написать сценарии, схему и экран», а всё вокруг уже было, проверялось
и подсказывало агенту правильное место.

1. **Репозиторий и ворота качества.** pnpm-workspace, Node 26, `tooling/tsconfig.base.json` (TS 7, стираемый синтаксис),
   Oxlint (type-aware) + oxfmt (точная версия), lefthook + commitlint + проверка размера коммита, Turborepo (typecheck,
   build), Makefile со всеми целями NFR-14, `make check` = формат + линт + типы + тесты + границы. *Готово:* `make check`
   зелёный на пустом проекте и красный на намеренной ошибке каждого вида.
2. **Архитектура как код.** `tooling/architecture/modules.ts` (36 модулей, ярусы, `dependsOn`, `userData`), генератор
   правил dependency-cruiser (+ `typescript@6` рядом), `deps-guard`, фикстуры нарушений с тестом «каждое правило ловит
   своё», генерация таблицы `docs/CAPABILITIES.md`, генератор заготовок `make new-module id=…` / `make new-feature`.
3. **Общие пакеты.** `kernel` (Money, LocalDate, Period, Scope, бренды, TraceNode), `calc` (тип `Calc<T>`, помощники
   трассы, одна настоящая функция — `freeBalance` с тестами-примерами), `contract` (каталог ошибок, общие схемы,
   `health`, `PageContext`, части сообщений чата, `events.stream`), `i18n` (ru, типизированные ключи, formatMoney/
   formatDate = DES-17, NFR-23), `testing` (фабрики, FakeClock, MemoryBlobStore, шаблонная БД, кассеты Record/Replay).
4. **Платформа сервера.** config (env через Zod), логи (pino + ALS + ротация), errors, db (пул, роли `kosht_owner`/
   `kosht_app`, `uow`, `userOwnedTable`/`systemTable`/`publicTable`, первая миграция с расширениями, миграции при старте под
   `pg_advisory_lock`), jobs (pg-boss, `background_job_run`, `missed: 'once'`, конверт со `scope`/`requestId`), events
   (публикация в транзакции, подписки, `NOTIFY`), settings + secrets (AES-256-GCM, мастер-ключ в файле), blob-store, http
   (Hono + oRPC, request-id, заголовки, CSRF, лимиты, два порта), `/healthz`, `/readyz`, три точки входа и корректное
   завершение по SIGTERM.
5. **Все модули пустыми, но живыми.** 36 папок по шаблону с паспортами, `index.ts`, фабрикой и пустыми списками;
   корень композиции собирает их в порядке `modules.ts`; реестры (инструменты, каналы, отмена, владельцы данных,
   настройки) работают на пустых списках. *Готово:* граф dependency-cruiser содержит все модули, тест порядка зелёный.
6. **Сквозной срез («ходячий скелет»).** `identity` в минимуме (Better Auth: первый запуск только с localhost, вход,
   сессия) + `accounts.list` (счёт «Наличные») с RLS: контракт → роутер → `uow` → БД → сайт (TanStack Query) → e2e.
   Тест «пользователь A не видит счёт B» уже здесь. Это не бизнес-функция, а проверка, что все слои стыкуются.
7. **ИИ-шлюз и чат-заглушка.** `llm`: таблицы реестра моделей и цепочек, `LlmGateway` с провайдером-заглушкой и режимами
   `replay|record|live`, журнал расхода, Langfuse (профиль `observability`), запрет вызова внутри транзакции, интерфейс
   маскирования. `agent`: цикл на `MockLanguageModelV4` с одним инструментом через `defineTool`. `chat.send` по oRPC
   → `useChat` рисует поток, шаг и карточку. Самая рискованная стыковка проверяется до бизнес-кода.
8. **Фронтенд-каркас и дизайн-система.** Vite + TanStack Router + Query + клиент oRPC, тема из `tokens.css`, шрифты,
   ~16 базовых компонентов `ui/`, каркас (меню, верхняя панель, нижняя панель телефона, плавающая кнопка, `Sheet`),
   i18n, клиент `events.stream`, граница ошибок, `/dev/gallery` со всеми состояниями. *Готово:* axe — 0 нарушений на
   галерее (1440/390), скриншоты сверены с `kit.css`.
9. **Запуск, тестовая инфраструктура, правила агентов, документы.** `compose.yaml` с профилями (db; app = api/worker/bot;
   models; observability), Dockerfile (tsdown → один `.mjs` на точку входа), `make dev/up/down/logs/db-reset/backup/doctor`;
   Vitest projects (unit, int, web) + глобальная шаблонная БД, Playwright + axe в режиме кассет; `.claude/agents/*`,
   `/task-cycle`, `.claude/rules/*` (раздел 6), корневой `CLAUDE.md`; `docs/ARCHITECTURE.md` и ADR 0001…: стек, модульный
   монолит, карта модулей, Scope+RLS, события, ИИ-шлюз, поток чата через oRPC, FSD-lite.

---

## 8. Риски и сомнения (doubt-driven)

Для каждого рискованного решения — почему оно может оказаться неверным и что проверить в «бетонной» фазе (с порогом).

### 8.1 «Scope явно + транзакция из контекста + RLS»

- **Утверждение.** Связка `uow.run(scope)` + `AsyncLocalStorage` + `SET LOCAL app.household_id` + политики RLS даёт
  изоляцию, которую нельзя забыть.
- **Почему может быть неверно.** (а) Контекст ALS теряется в некоторых асинхронных местах — колбэки потоков AI SDK,
  итераторы oRPC, обработчики pg-boss: репозиторий получит `NO_TRANSACTION` или, хуже, чужую транзакцию.
  (б) Better Auth и pg-boss ходят в БД своими запросами мимо `uow` — их таблицы должны быть системными, иначе вход
  сломается. (в) Транзакция на каждый вызов инструмента и каждый запрос — накладные расходы. (г) Генерация политик
  Drizzle 1.0 RC может отличаться от документации.
- **Проверить.** Тест: инструмент агента, вызванный **внутри потока** `streamText`, видит свой `Scope`; задача pg-boss
  и подписка — тоже; запрос без `Scope` к `userOwnedTable` возвращает 0 строк; `kosht_app` не может `SET ROLE`/обойти
  RLS. Замер: 1000 `uow.run` с простым запросом — накладные расходы ≤ 1 мс на вызов. Если ALS ломается в потоках —
  запасной путь: явный `tx` в фасадах (правило и генератор поменять до первого модуля).

### 8.2 Один серверный пакет и границы только на dependency-cruiser

- **Утверждение.** 36 модулей в одном пакете не превратятся в «ком грязи», потому что границы проверяет программа.
- **Почему может быть неверно.** dependency-cruiser с TS 7 молча проверяет 0 файлов (01); регулярное выражение
  с опечаткой не ловит ничего; динамический `import()` и реэкспорты через `index.ts` («пробросить всё наружу») обходят
  смысл правил; агенты «лечат» нарушение добавлением зависимости в `modules.ts`.
- **Проверить.** `deps-guard` с порогом числа файлов; фикстура нарушения на **каждое** правило; правило-проверка
  `index.ts` (экспортирует только из `module.ts`/`facade.ts` и типы, без `export *` из `infrastructure`); хук/ревьюер:
  любая правка `modules.ts` = отдельный пункт отчёта с обоснованием (а для новой связи вверх — ADR). Время
  `make deps-check` на 36 модулях с кэшем — ≤ 10 с.

### 8.3 События «хотя бы раз» и штормы пересчётов

- **Утверждение.** pg-boss-события в той же транзакции — надёжная связь снизу вверх.
- **Почему может быть неверно.** Импорт 300 операций → пересчёты лимитов, регулярных, вычетов, прогноза:
  при событиях «по операции» — сотни задач и дубли уведомлений «80 %»; повторная доставка шлёт уведомление дважды;
  порядок не гарантирован («удалена» раньше «создана»); задержка до секунд — пользователь не видит порог сразу.
- **Проверить.** Событие несёт пачку; у реакций — `singletonKey` по домохозяйству и задержка схлопывания; уведомления
  порогов идемпотентны по ключу «лимит+месяц+порог» (BUD-03 «один раз на порог»); тест: импорт 300 операций →
  ≤ 5 задач пересчёта и ровно одно уведомление; задержка «записал трату → уведомление 80 %» ≤ 3 с на демо.

### 8.4 Поток чата через oRPC и «агент не знает модулей»

- **Утверждение.** Чат — обычная процедура oRPC (интеграция с AI SDK), инструменты собираются реестром, ответ
  дописывается при закрытой вкладке.
- **Почему может быть неверно.** Интеграция oRPC ↔ AI SDK описана для ветки документации, имена функций могут
  отличаться в 1.16, а v2 в бете; прокси метаданных ломает `structuredClone`; «отвязанный» запуск агента в процессе
  `api` теряется при перезапуске; 35 инструментов в реестре без жёстких наборов съедят лимит Groq (04).
- **Проверить.** Спайк в шаге 7: поток через Vite-прокси, отмена кнопкой «Стоп» освобождает модель, закрытие вкладки —
  ответ сохранён в БД, повторное открытие показывает его; размер префикса (подсказка + набор `core`) ≤ 3 тыс. токенов.
  Запасной путь — отдельный маршрут Hono `/api/chat` с UI-потоком AI SDK и той же проверкой сессии (решение — ADR).

### 8.5 Гранулярность: «бог-модули» и цепочки фасадов

- **Утверждение.** 36 модулей с явными зависимостями — правильный размер.
- **Почему может быть неверно.** `transactions` (сопоставление, переводы, возвраты, разбивка, агрегации, история)
  и `legal-base` рискуют стать «модулями-богами»; `dashboard` зовёт 8 фасадов → десятки запросов (N+1) и медленная
  главная; крошечные `voice`, `fx-rates`, `explain` — лишние паспорта.
- **Проверить.** До первой задачи `transactions` — согласовать его фасад (агрегации пачками: `aggregate({period,
  groupBy})`, а не «по одной категории»); замер главной на демо-данных — ≤ 300 мс на сервере; правило «сценарий
  > 300 строк или модуль > 25 файлов в `application/` — предложить разделение через ADR». Мелкие модули можно слить
  без последствий для остальных (их id уже стоят в карте).

---

## Вопросы к пользователю

Только настоящие развилки; у каждой — рекомендация.

1. **Двойной замок на чужие данные (RLS в базе) — делаем?**
   *Пример:* в будущем коде агент забыл условие «только мои операции». С RLS база всё равно вернёт только ваши
   операции; без RLS — чужие. Цена — примерно день работы в «бетонной» фазе и правило «каждый запрос в транзакции».
   **Рекомендую: да** (это прямая гарантия ROLE-01 и PRIV-07, и её можно показать на защите).
2. **Сайт не считает никаких денег сам?**
   *Пример:* на экране «Крупная покупка» вы двигаете ползунок суммы — пересчёт сценариев идёт на сервере
   (~50–100 мс задержки), зато каждое число объяснимо и совпадает с ответом ассистента.
   **Рекомендую: да** (P1 + «Откуда эта цифра?»); если ползунок покажется медленным — разрешим точечное исключение ADR.
3. **Три процесса сервера (сайт, фоновые задачи, бот) вместо одного?**
   *Пример:* загрузили 10 фото iPhone — тяжёлая обработка идёт в «воркере», а сайт и чат не подтормаживают; в списке
   контейнеров будет на два больше. **Рекомендую: три** (одинаково в разработке и на показе).
4. **Паспорта всех 36 модулей — сразу в «бетонной» фазе или по мере работы?**
   *Пример:* сразу — агент, делающий «Чеки», видит в паспорте `calendar`, что события гарантии создаёт календарь, и не
   пишет их сам. **Рекомендую: сразу, короткими** (назначение, требования, зависимости, запреты), подробности —
   в задаче модуля.
5. **Язык правил для агентов.** Паспорта, правила, комментарии — на русском; имена в коде, коды ошибок, события,
   ключи логов, описания инструментов агента — на английском. **Рекомендую так**, если нет возражений
   (Claude хорошо следует русским правилам, а английские «машинные» имена экономят токены модели и упрощают поиск).

---

## Итог одним списком

| Решение | Рекомендованный вариант | Почему (одна строка) |
|---|---|---|
| Раскладка | `apps/{web,server}` + `packages/{kernel,calc,contract,i18n,testing}` + `e2e`, `datasets`, `tooling`, `docs`, `tasks` | минимум пакетов, у каждого одна причина меняться |
| Процессы сервера | один пакет, три точки входа `api`/`worker`/`bot`, связь через Postgres | изоляция тяжёлого и бота без дублирования кода |
| Архитектура бэкенда | модульный монолит: `domain/application/infrastructure/api/jobs/agent`, сценарий = файл, порты только наружу | предсказуемо для агентов, честные тесты на БД, мало шаблонного кода |
| Карта модулей | 36 id в 4 ярусах, `modules.ts` — источник правды, из него правила и `CAPABILITIES.md` | одна правда для кода, проверок и документации |
| Связи модулей | вниз — фасад; вверх — событие pg-boss в той же транзакции; подстановка вниз — реестр | без циклов, без потерянных событий |
| Изоляция | `Scope` первым аргументом + RLS по `household_id`, две роли БД, админ без доступа к финансам | двойной замок ROLE-01/PRIV-07 |
| Транзакции | `uow.run(scope)` открывает сценарий, репозиторий берёт из контекста, модель — вне транзакции | короткие транзакции, нельзя забыть пользователя |
| Расчёты | `packages/calc`, только `kernel`, всё возвращает `{ value, trace }`, деньги в копейках | P1/P2 по построению, быстрые тесты |
| Контракт | oRPC + Zod в `packages/contract`, каталог ошибок, карточки и события там же | фронт знает о сервере только это |
| Ошибки | `AppError(код, params)` → oRPC/инструмент/задача; тексты по коду через i18n | один формат, без утечек, переводимо |
| ИИ-слой | `llm` — единственный знает провайдеров, отдаёт «цепочку как одну модель»; `agent` собирает инструменты реестром | границы целы, провайдер меняется настройкой |
| Инструменты агента | `defineTool` в модуле-владельце, виды read/write/destructive, Scope из запуска | модель не может удалить и не может выбрать чужого пользователя |
| Поток чата | процедура oRPC (интеграция с AI SDK), «Стоп» отдельной процедурой, ответ дописывается | одна проверка сессии и ошибок; запасной путь — маршрут Hono |
| Фронтенд | FSD-lite: app → routes → features → entities → ui/lib | изоляция экранов без церемоний полного FSD |
| Дизайн-система | `apps/web/src/ui` поверх Mantine, тема из `tokens.css`, ~16 компонентов по `kit.css` | один потребитель; вынос в пакет — механический |
| Данные на фронте | клиент oRPC + TanStack Query, инвалидация по `events.stream`, состояние в адресе | обновления от агента и бота приходят сами |
| Границы | dependency-cruiser из `modules.ts` (+ TS 6), `deps-guard`, фикстуры нарушений | прототип: 16/16 нарушений, 0 ложных |
| Конвенции | kebab-файлы, английские имена, русские комментарии, тесты рядом, `*.int.test.ts` на реальной БД | агент находит код и тест в одном месте |
| Правила агентов | паспорт `CLAUDE.md` в каждом модуле/фиче/пакете + 12 правил `.claude/rules` с `paths:` | правила грузятся только там, где нужны |
| «Бетонная» фаза | 9 шагов: ворота → архитектура как код → пакеты → платформа → пустые модули → сквозной срез → ИИ-заглушка → фронт-каркас → запуск и правила | первая бизнес-задача пишет только бизнес-код |
| Главные риски | ALS+RLS в потоках, «молчащие» границы, штормы событий, поток чата через oRPC, «бог-модули» | у каждого — проверка с порогом в «бетонной» фазе |
