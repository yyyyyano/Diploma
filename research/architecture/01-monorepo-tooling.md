> **Справочник, а не требования.** Результат ресерча архитектуры (2026-10-24). Требования — только
> в [`SPEC.md`](../../SPEC.md). Здесь — варианты и рекомендации для обсуждения с пользователем,
> окончательные решения фиксируются позже в ADR и `docs/ARCHITECTURE.md`.

# 01. Монорепозиторий и инструменты разработки

Метки уверенности: **[В]** проверил сам (команда на этой машине, `npm view`, официальная документация),
**[С]** косвенно (из чужого описания, из памяти), **[Н]** предположение / моё предложение.
Опыты лежат в `/tmp/claude-1000/-home-user-University-DiplomaSupport-yana/b028d80d-e3f9-43c1-8889-7cdf568be4ad/scratchpad/research-monorepo/`
(`p1` — линтеры и dependency-cruiser, `p2` — мини-монорепа pnpm + Turborepo + Vitest + tsdown,
`p3` — PGlite, `p4` — git-хуки и commitlint). В проект ничего не устанавливалось.

## 0. Главное за одну минуту

1. **pnpm 12 + Node.js 24 LTS** (Node 26 становится LTS 2026-10-28 — перейти позже одной строкой). Bun — не нужен.
2. **Turborepo** поверх pnpm — только для `typecheck`/`build`/`e2e`; тесты, линт и форматирование запускаются
   с корня целиком (они и так за секунды).
3. **Раскладка «модульный монолит»:** `apps/web`, `apps/server` (три точки входа: api / worker / bot),
   `packages/contracts`, `packages/domain`, `packages/i18n`, `packages/testing`, `e2e/`. Вариант Б
   (отдельные apps и пакет на каждую фичу) — как путь роста, а не стартовая точка.
4. **TypeScript 7.0.2 (нативный компилятор)**, внутренние пакеты **без сборки** (в `exports` лежит `.ts`),
   Node 24 запускает такие файлы сам. Для боевых контейнеров приложения собираются в один файл через tsdown.
5. **Oxlint (type-aware — стабилен) + oxfmt (бета, 0.x)**. Риск у oxfmt один: формат может чуть «поплыть»
   между версиями — закрепляем точную версию. Запасной вариант — Biome; ESLint+Prettier сейчас хуже из-за TS 7.
6. **dependency-cruiser работает с TS 7 только через обходной путь** (находка этого ресерча, см. §6):
   без него проверка границ **молча проверяет 0 файлов и сообщает «всё хорошо»**. Обходной путь проверен.
7. **Vitest 5 (`projects`) + Playwright + Testcontainers**; записанные ответы моделей — собственные «кассеты»
   на границе слоя LLM, а не на уровне HTTP.
8. **Хуки: lefthook + commitlint + собственный скрипт размера коммита** (написан и проверен, приложение А).
   CI нет, поэтому хуки + `make check` — единственные ворота качества.

## 1. Снимок версий на 2026-10-24 [В — `npm view`]

| Инструмент | Версия (дата) | Лицензия | Заметка |
|---|---|---|---|
| Node.js | 24.22.1 «Krypton» (LTS с 2025-10-28, с 2026-10-20 — maintenance до 2028-04-30); 26.12.1 (LTS с 2026-10-28 до 2029-04-30); 22.23.4 (до 2027-04-30) | MIT | на машине стоит 24.21.0 |
| pnpm | 12.15.0 (2026-10-24); на машине 12.5.1 | MIT | параллельно живут ветки 11.28.x и 10.34.x |
| npm / Bun / Yarn | 12.2.1 / 1.4.4 / 1.22.22 (classic), Berry 4.18.1 | Artistic-2.0 / MIT / BSD-2 | Bun на машине не установлен |
| Turborepo / Nx / moon | 2.11.10 / 24.0.1 (мажор вышел 2026-10-21) / 2.6.4 | MIT | |
| TypeScript | **7.0.2** (2026-10-24), 7.1.0-beta (2026-10-20) | Apache-2.0 | нативный компилятор на Go, команда `tsc` прежняя |
| tsdown / tsup | 0.23.2 / 9.0.0 | MIT | tsdown — 0.x |
| Oxlint / oxlint-tsgolint | 1.89.0 (2026-10-19) / 7.0.2005 | MIT | выпуски еженедельные |
| oxfmt | **0.74.0** (2026-10-19) | MIT | бета, 0.x |
| Biome / ESLint / Prettier | 2.6.2 / 10.13.0 / 3.9.10 | MIT | запасные варианты |
| dependency-cruiser | 18.7.0 (2026-10-19); 18.8.0-beta-1 (2026-10-23) | MIT | см. §6 |
| Vitest / Vite | 5.0.5 (5.1 beta) / 8.3.5 | MIT | |
| Playwright / @axe-core/playwright | 1.64.1 / 4.14.0 | Apache-2.0 / MPL-2.0 [С] | |
| Testcontainers (+postgresql) | 12.2.1 (нужен Node ≥ 22.22) | MIT | |
| lefthook / husky / simple-git-hooks | 2.2.2 / 9.1.7 / 2.14.0 | MIT | |
| commitlint (cli, config-conventional) | 21.2.4 | MIT | |
| lint-staged | 17.6.0 | MIT | не нужен при lefthook |
| MSW / nock / Polly.js | 3.0.3 / 15.0.5 / 6.0.6 (**последний выпуск 2023-07**) | MIT / MIT / Apache-2.0 | Polly заброшен |
| knip | 6.43.0 | ISC | поиск неиспользуемого кода |
| Vite+ (`vite-plus`) | 1.4.0 | MIT | единая обёртка VoidZero, см. §5 |
| PGlite | 0.5.11 | Apache-2.0 | Postgres 18.6 в WASM, см. §7 |

---

## 2. Менеджер пакетов и среда выполнения

**Что решаем и почему важно.** Менеджер пакетов определяет, как устанавливаются библиотеки и «видят» ли пакеты
монорепы друг друга. Например, если `apps/web` случайно импортирует библиотеку, которую объявил только
`apps/server`, строгий менеджер упадёт сразу, а нестрогий — в самый неудобный момент.

| Вариант | Суть | Плюсы | Минусы | Зрелость | Соответствие SPEC |
|---|---|---|---|---|---|
| **pnpm 12** | строгий `node_modules` через ссылки, workspaces, catalogs | нет «фантомных» зависимостей (опора для границ модулей), единый список версий (`catalog:`), защита цепочки поставки по умолчанию: пакеты моложе 24 ч не ставятся (`minimumReleaseAge: 1440`), скрипты сборки зависимостей запрещены, пока не разрешены в `allowBuilds` [В] | своя папка `.pnpm` сбивает инструменты, не умеющие в симлинки (редко) | 12.15.0, 2026-10-24; ветки 10/11 тоже поддерживаются [В] | NFR-10, NFR-13 |
| npm 12 | встроенный | ничего ставить не надо | нет аналога catalogs, не строгий [С] | 12.2.1 | допустимо |
| Bun 1.4 | менеджер + рантайм + тест-раннер | очень быстрая установка | V8-покрытие Vitest не работает на Bun (прямо в документации Vitest [В]); второй рантайм = «у меня работает, в Docker нет»; нативные модули (эмбеддинги в Node) — риск [Н] | 1.4.4 | NFR-11 (покрытие) под вопросом |
| Yarn | classic 1.x — наследие; Berry 4 | PnP, плагины | classic заморожен (1.22.22 от 2025-11), Berry добавляет своих странностей | — | нет причин |

**Рекомендация: pnpm 12, только Node.js, без Bun.** Версию pnpm закрепить в `packageManager` корневого
`package.json` (Node 24 ещё содержит `corepack` [В: `corepack 0.36.0` на машине]); настройки живут
в `pnpm-workspace.yaml`. Что изменило бы выбор: если появится необходимость запускать код на Bun
(сейчас её нет — Node 24 сам запускает TypeScript, см. §5).

**Версия Node.** Рекомендую **Node 24** сейчас (она уже стоит; все инструменты её поддерживают: Vitest `^24`,
tsdown `^24.11`, dependency-cruiser `^24`, Testcontainers `>=22.22`) [В]. **Node 26 станет LTS через
4 дня (2026-10-28)** [В: `nodejs/Release/schedule.json`]; переходить стоит, когда выйдет образ `node:26` и
проверится нативные зависимости (эмбеддинги, `sharp` и т. п.) — это правка `.node-version` и `ARG` в Dockerfile.
Версию держим в одном файле `.node-version`, `engines` — `>=24`.

Пример `pnpm-workspace.yaml` (проверен на pnpm 12.5.1 в `p1`/`p2`):

```yaml
packages: [apps/*, packages/*, e2e]
catalog:                      # единый список версий: в package.json — "zod": "catalog:"
  zod: ^4
  typescript: ^7.0.2
  vitest: ^5.0.5
minimumReleaseAge: 1440       # не ставить пакеты моложе суток (по умолчанию так с pnpm 11)
allowBuilds:                  # какие пакеты вправе выполнять скрипты установки
  lefthook: true              # без этого хуки не установятся (pnpm сам добавит строку-заглушку)
packageExtensions:            # обходной путь для dependency-cruiser, см. §6
  dependency-cruiser@*:
    dependencies:
      typescript: "^6.0.2"
```

**Стыковка.** Docker-исследователю: образ собирается по `pnpm-lock.yaml`; **`pnpm deploy` + запуск `.ts`
напрямую не работает** (§5). Бэкенд-исследователю: выбор фреймворка влияет на `erasableSyntaxOnly` (§5).

**Риски.** pnpm 12 свежий мажор — на практике в экспериментах работал без замечаний [В]. Блокировка скриптов
сборки: каждая новая нативная зависимость потребует строки в `allowBuilds` (это защита, а не баг).

---

## 3. Оркестрация монорепы

**Что решаем.** Монорепа — это много пакетов с общими командами (`typecheck`, `build`). Оркестратор решает:
в каком порядке запускать, что можно пропустить, потому что результат уже есть («кэш»), и что запускать
только для затронутых изменением пакетов («affected»). Пример: поправили `packages/domain` — перепроверяются
типы самого `domain` и тех, кто его импортирует, а `apps/web` без связи с ним остаётся «из кэша».

| Вариант | Суть | Плюсы | Минусы | Зрелость | Лицензия |
|---|---|---|---|---|---|
| **pnpm workspaces + Turborepo** | `turbo.json` описывает задачи и зависимости, кэш на диске | кэш; `--affected`; один небольшой файл; убрать — легко | ещё один инструмент; кэш ценен лишь когда задачи долгие | 2.11.10, 2026-10-20 | MIT |
| Nx 24 | граф проекта, плагины, генераторы, свои module-boundaries | самый богатый | тяжёлый, навязывает свою структуру; проверка границ у Nx завязана на ESLint [С], а мы выбрали Oxlint; мажор вышел 4 дня назад | 24.0.1 | MIT |
| moon 2 | на Rust, проекты и задачи в YAML | быстрый, умеет и менеджить тулчейн | малая экосистема, меньше примеров для агентов [Н] | 2.6.4 | MIT |
| Только pnpm | `pnpm -r`, `--filter "...[origin/main]"` | ничего лишнего | кэша нет, порядок задач вручную | — | MIT |

**Опыт [В, `p2`].** Две задачи `typecheck` (TS 7): первый прогон 636 мс, второй — 21 мс «FULL TURBO»;
после правки одного файла в `packages/shared` `--affected` выбрал и сам `shared`, и зависящий от него `api`.
При этом сам `tsc` 7 проверяет мини-проект за ~0,15 с — на нашем масштабе (2 приложения, 4–5 пакетов)
выигрыш от кэша **пока небольшой**; он вырастет, когда пакетов и кода станет заметно больше.
Нюанс: по умолчанию `--affected` работает на уровне пакета (любое изменение пакета запускает все его задачи);
точнее — флаг `futureFlags.affectedUsingTaskInputs` [В, документация Turborepo 2.11.7]. Сравнение с git
требует полной истории (локально это так).

**Рекомендация: pnpm + Turborepo, минимальный `turbo.json`** — задачи `typecheck`, `build`, `test:e2e`.
Линт (`oxlint`) и формат (`oxfmt`) запускаются с корня за миллисекунды и в Turbo не нужны; тесты — одним
`vitest` с `projects` (единое покрытие, §7). Что изменило бы выбор: если пакетов будет 3–4 и Turbo окажется
лишним — оставить «только pnpm» (переход в обе стороны не ломает структуру); если понадобится генерация
кода, графы проектов и плагины — Nx.

```jsonc
// turbo.json (проверен на 2.11.10)
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "typecheck": { "dependsOn": ["^typecheck"], "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/tsconfig.base.json"] },
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test:e2e":  { "cache": false }
  }
}
```

**Стыковка.** Makefile (§9) вызывает `pnpm …`, а те — `turbo run …`. Docker-исследователю: для урезания
контекста образа есть `turbo prune --docker` [С] или схема `pnpm fetch`.

---

## 4. Раскладка монорепы «Кошта»

**Что решаем.** Где живёт какой код. Это основа «бетонной» фазы: раскладка определяет, что агентам
разработки разрешено импортировать откуда, и потому — какие правила проверит dependency-cruiser.
Исходим из состава системы по SPEC: сайт (React), API со стримингом, фоновые задачи (законы, импорт выписок,
итоги недели — NFR-22), Telegram-бот (опрашивает Telegram сам — §1.4), общие схемы данных.

### Вариант А — «модульный монолит» (рекомендуется)

```
kosht/
├─ apps/
│  ├─ web/                  React-сайт (Vite). src/{app, features/<фича>, shared}
│  └─ server/               ВЕСЬ бэкенд в одном пакете, три точки входа:
│     └─ src/
│        ├─ entrypoints/    api.ts · worker.ts · bot.ts   ← разные процессы, один код
│        ├─ modules/        auth · receipts · statements · transactions · categories · budgets
│        │                  · law · agent · llm · notifications · telegram · admin · demo …
│        │   └─ <модуль>/   index.ts (единственный «вход»), domain/, app/, infra/, http/
│        └─ platform/       конфигурация, логгер, подключение к БД, очередь задач, ошибки
├─ packages/
│  ├─ contracts/            схемы данных (zod) и типы API — общие для фронта и бэка
│  ├─ domain/               чистая детерминированная логика: калькулятор вычетов, валидатор чека,
│  │                        сопоставление чек↔выписка, правила категорий, лимиты, формулы Excel.
│  │                        Без ввода-вывода: никаких БД, сети, файлов, React
│  ├─ i18n/                 русские тексты и ключи — одни и те же для сайта и бота (NFR-19)
│  └─ testing/              фабрики данных, помощники «кассет», запуск тестовой БД
├─ e2e/                     Playwright-сценарии (пакет @kosht/e2e)
├─ tooling/                 общие конфиги и скрипты: tsconfig.base.json, правила границ, check-commit-size.mjs
├─ docker/ · samples/ (вне git, NFR-18) · docs/ · Makefile · compose.yaml
└─ pnpm-workspace.yaml · turbo.json · .oxlintrc.json · .oxfmtrc.json · lefthook.yml · commitlint.config.js
```

**Почему так.** Сервер — один пакет с тремя точками входа: это три разных процесса (упал воркер — API
работает), но один код и один образ Docker с разными командами запуска. Модули внутри сервера общаются
только через свой `index.ts` — ровно то правило, которое проверяет dependency-cruiser (§6). Когда модуль
разрастётся, его можно вынести в пакет, не переписывая: границы уже проведены. Пример: изменение в
`receipts` не должно ломать `statements` — а сопоставление чек↔выписка идёт только через публичный
`index.ts` модуля.
`packages/domain` отделён, потому что принцип P1 («числа считает программа») требует самых строгих тестов
именно на этом коде, а чистота пакета (без БД и сети) проверяется правилом границ автоматически.
`ui` отдельным пакетом **не делаем**: приложение с интерфейсом одно (админка — часть `apps/web`, SPEC §6.24);
UI-кит живёт в `apps/web/src/shared/ui`. Вынести можно, когда появится второй потребитель.

### Вариант Б — «приложения + пакет на каждую фичу»

```
apps/{web, api, worker, bot}     тонкие «корни сборки»: только подключают пакеты
packages/{contracts, domain, i18n, testing, db, llm, receipts, statements, law, agent, …}
```

| | Вариант А | Вариант Б |
|---|---|---|
| Границы между фичами | правило dependency-cruiser | сам `package.json` (не объявил зависимость — не импортируешь) **плюс** dependency-cruiser |
| Шаблонного кода | мало | много: у каждой фичи `package.json`, `tsconfig`, конфиг тестов |
| Скорость кэша Turbo | пакетов мало — выигрыш малый | выше (кэш по фичам) |
| Стоимость переделки модуля | вынос в пакет по мере нужды | уже сделано |
| Когда лучше | один разработчик + агенты, ~12 модулей | команда, независимые релизы, десятки модулей |

**Рекомендация: вариант А.** Для одного разработчика и ИИ-агентов 15 пакетов — это 15 `package.json` для
поддержки без выигрыша. Правила границ сразу пишем так, чтобы вариант Б получился механическим переносом.
Что изменило бы выбор: желание показать на защите диплома строго «пакетную» архитектуру или появление
второго сервиса (например, отдельный сервис эмбеддингов на другом языке).

**Стыковка.** Бэкенд-исследователь (фреймворк, ORM) выбирает содержимое `modules/*`; исследователь
ИИ-слоя — где живут `llm` и `agent` (в варианте А это модули сервера; вынос в пакет возможен позже);
Docker — один образ `server` и три службы compose; фронт — `apps/web`.

**Риски.** (1) «Модульный монолит» держится на дисциплине: без включённого правила `module-public-api-only`
через месяц получится «ком грязи» — правило обязательно с первого коммита. (2) Если обсуждение выберет NestJS
(декораторы), потеряем запуск `.ts` без сборки (§5).

---

## 5. TypeScript, сборка пакетов, запуск

**Что решаем.** Какой версией TypeScript проверять типы и как пакеты монорепы отдают свой код друг другу.
Пример: хотим, чтобы правка в `packages/contracts` тут же была видна в `apps/web` и `apps/server` без
промежуточной «сборки пакета».

### 5.1 Версия и подводные камни [В]

TypeScript **7.0.2** — нативный компилятор на Go, команда `tsc` та же; Microsoft заявляет сборку в 8–12 раз
быстрее шестой версии [В: блог TypeScript]. На нашем мини-проекте `tsc -p` занимает ~0,15 с [В].
Нужно знать:

- **Нет стабильного программного API** до TypeScript 7.1 (7.1.0-beta уже вышла 2026-10-20). Всё, что
  «встраивает» TypeScript (typescript-eslint, dependency-cruiser), требует пакета совместимости
  `@typescript/typescript6` или обычного `typescript@6` рядом [В: блог TS 7.0].
- Удалены `baseUrl`, `moduleResolution: node10`, `target: es5` и др.; `strict` теперь включён по умолчанию,
  `types` по умолчанию пуст (нужно явно `"types": ["node"]`) [В].
- Oxlint type-aware требует именно TS 7 (tsgolint 7.x привязан к 7.0.2) [В].

### 5.2 Как пакеты отдают код

| Вариант | Суть | Плюсы | Минусы | Зрелость |
|---|---|---|---|---|
| **«Внутренние пакеты» без сборки** | в `exports` лежит `./src/index.ts`; потребитель (Vite, Vitest, Node 24) читает исходники | ноль шагов сборки, правка видна сразу, стек-трейсы с настоящими строками | нельзя публиковать в npm (нам не нужно); потребитель обязан уметь `.ts` | проверено: Vite/Vitest — да, Node 24 — да [В] |
| tsdown 0.23 (Rolldown) | собирает `dist` с `.d.ts` | быстрый, современный | 0.x; нужен лишь для публикуемых библиотек | 0.23.2 |
| tsup 9.0 | на esbuild | привычный | в сторону tsdown смотрят и сами авторы [С] | 9.0.0 |
| `tsc -b` + references | классика | эталонные типы | медленнее, шаг сборки, «composite» | 7.0.2 |

**Рекомендация.** Пакеты `contracts`, `domain`, `i18n`, `testing` — **внутренние, без сборки**. Каждый
пакет имеет свой `tsconfig.json` (наследует `tooling/tsconfig.base.json`), типы проверяются
`tsc -p . --noEmit` через Turbo; **project references не нужны**, пока нет эмиссии (проверено: проверка типов
пакета, импортирующего соседний пакет, работает без references [В]).

**Node 24 запускает такие файлы сам [В, `p2`]:** `node apps/api/src/main.ts` — и workspace-пакет с `.ts`
в `exports` импортируется без сборки. Условия: только «стираемый» синтаксис (`erasableSyntaxOnly`: без
`enum`, `namespace`, параметров-свойств конструктора — компилятор сразу ругается TS1294 [В]), импорты
с расширением `.ts`, и `verbatimModuleSyntax`. Для разработки это даёт `node --watch src/entrypoints/api.ts`
без сборщика.

**Ловушка для Docker [В, `p2`].** Если собрать образ через `pnpm deploy`, workspace-пакеты оказываются
внутри `node_modules`, а Node **отказывается стирать типы в файлах из `node_modules`**
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Значит для боевых образов:

| Вариант запуска в образе | Плюсы | Минусы |
|---|---|---|
| **Собрать каждую точку входа tsdown в один `.mjs`** (рекомендуется) | запуск за миллисекунды, маленький образ, нет проблемы `node_modules`; проверено: 19 мс, workspace-пакет вшит [В] | шаг сборки; tsdown 0.x (в 0.23 опция `noExternal` помечена устаревшей в пользу `deps.alwaysBundle` [В]); нативные/динамические зависимости надо вывести во внешние |
| Копировать репозиторий целиком и `pnpm install --prod` (без `deploy`) | «нулевая сборка» | больше образ; стирание типов при каждом старте |
| `tsc` с эмиссией в `dist` | без новых инструментов | пакеты тогда нужно собирать, теряем «без сборки» |

Запасной вариант сборщика — чистый `esbuild`, если tsdown подведёт.

Базовый `tooling/tsconfig.base.json` (компилируется TS 7.0.2 без ошибок, `p2`):

```jsonc
{ "compilerOptions": {
    "target": "es2024", "lib": ["es2024"], "module": "nodenext", "moduleResolution": "nodenext",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true, "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true, "erasableSyntaxOnly": true, "isolatedModules": true,
    "allowImportingTsExtensions": true, "rewriteRelativeImportExtensions": true,
    "noEmit": true, "skipLibCheck": true, "types": ["node"] } }
```
Для `apps/web` поверх: `"module": "esnext", "moduleResolution": "bundler", "jsx": "react-jsx", "lib": ["es2024","dom","dom.iterable"], "types": ["vite/client"]`.
Псевдонимы вида `@/…` лучше не вводить: Node их не понимает; использовать относительные пути или поле
`imports` в `package.json` (`#app/*`) [С].

**Стыковка.** Бэкенд-исследователю: фреймворки с декораторами и метаданными типов (NestJS) несовместимы
с `erasableSyntaxOnly` — придётся вернуться к `tsx`/сборке (выбор допустим, но цена известна). Hono, Fastify,
Kysely/Drizzle — без проблем [С]. ИИ-слою: LangChain/LangGraph — обычные ESM-пакеты, на этот выбор не влияют.

**Риски.** Свежий мажор TS: часть инструментов ещё на пути к TS 7 (см. §6, §8). Открытый вопрос: брать ли
Node 26 сразу (стирание типов в 26 стабильно, в 24.21 предупреждений нет [В: запуск без предупреждения]).

---

## 6. dependency-cruiser: границы модулей

**Что решаем.** Правила вида «сайт не импортирует сервер», «модуль `statements` не лезет внутрь `receipts`»,
«в `packages/domain` нельзя подключать `node:fs`». Без автоматической проверки эти правила держатся на
честном слове — особенно когда код пишут ИИ-агенты. С проверкой нарушение видно сразу (в хуке и в `make check`).

| Вариант | Суть | Плюсы | Минусы | Зрелость |
|---|---|---|---|---|
| **dependency-cruiser** | читает граф импортов, правила `forbidden` с регулярными выражениями и «группами» `$1` | ровно то, что просил пользователь; циклы, сироты, слои, папки; картинка графа (для диплома); независим от линтера | **с TS 7 нужен обходной путь**; нужно прописать резолвер | 18.7.0 (2026-10-19) |
| eslint-plugin-boundaries 7.3 | правила «типы элементов» в ESLint | рядом с линтером | требует ESLint — у нас Oxlint (JS-плагины Oxlint в альфе [В]); цикл-проверки нет | 7.3.0 |
| Nx module boundaries | теги проектов | удобно в Nx | только в Nx + ESLint | — |
| Sheriff (`@softarc/sheriff-core`) | границы по папкам и тегам | лаконичный | 0.20, нацелен на Angular [С] | 0.20.0 |
| `no-restricted-imports` (Oxlint) | запрет конкретных путей | уже есть | грубо, без графа и групп [С] | — |

### 6.1 Что я проверил и нашёл (важно) [В, `p1`/`p2`]

1. **dependency-cruiser 18.7 не поддерживает TypeScript 7.** При установленном `typescript@7` он печатает
   предупреждение `missing-tsc-transpiler` и… **«0 modules cruised, ✔ no dependency violations found»,
   код выхода 0** — то есть проверка границ молча превращается в пустую. Фраза в сообщении:
   «Support for typescript@>=7 will follow when its API is published and stable». В релизе
   **18.8.0-beta-1 (2026-10-23)** заявлена «поддержка typescript >=7.1 (native compiler)» [В: страница
   релизов] — то есть постоянное решение появится вместе с TS 7.1.
2. **Обходной путь работает:** добавить dependency-cruiser собственный `typescript@^6` через
   `packageExtensions` в `pnpm-workspace.yaml` (см. §2) и `parser: "tsc"` в конфиге — pnpm ставит
   `typescript@6.0.3` рядом с `7.0.2`, `tsc` остаётся седьмым, граф строится.
3. **Импорты workspace-пакетов нужно «научить» резолверу:** `import … from "@kosht/shared"` при `exports → ./src/index.ts`
   без настроек помечается `couldNotResolve: true`, и правила про пакеты **не срабатывают**. Лечится
   `enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import","node","default"], extensions: [".ts",".tsx",".js",".mjs",".json"] }` —
   после этого ребро ведёт на настоящий файл `packages/shared/src/index.ts`.
4. **Страховка от «молчаливого нуля»:** в `make deps-check` добавить проверку, что число проверенных
   модулей больше нуля (например, `depcruise … -T json | node -e` или правило `not-to-unresolvable`).

### 6.2 Правила под нашу раскладку (проверены на синтетическом дереве: 6 нарушений поймано, ложных нет)

```js
// .dependency-cruiser.cjs (фрагмент; пути адаптировать к реальной раскладке)
const SRV = "^apps/server/src/modules", WEB = "^apps/web/src";
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "web-not-to-server", severity: "error",
      comment: "Фронт и бэк общаются только через packages/contracts",
      from: { path: "^apps/web/" }, to: { path: "^apps/server/" } },
    { name: "server-not-to-web", severity: "error", from: { path: "^apps/server/" }, to: { path: "^apps/web/" } },
    { name: "module-public-api-only", severity: "error",
      comment: "В чужой модуль сервера — только через его index.ts",
      from: { path: `${SRV}/([^/]+)/` },
      to:   { path: `${SRV}/([^/]+)/`, pathNot: [`${SRV}/$1/`, `${SRV}/[^/]+/index\\.ts$`] } },
    { name: "domain-layer-is-pure", severity: "error",
      from: { path: `${SRV}/[^/]+/domain/` }, to: { path: `${SRV}/[^/]+/(app|infra|http)/` } },
    { name: "domain-package-no-io", severity: "error",
      comment: "packages/domain — чистые вычисления: без ввода-вывода",
      from: { path: "^packages/domain/" },
      to: { dependencyTypes: ["core"], path: "^(node:)?(fs|net|http|https|child_process|dns)(/|$)" } },
    // + запрет npm-пакетов pg/react/langchain в packages/domain: to: { path: "^(pg|react|@langchain)" }
    { name: "contracts-only-zod", severity: "error",
      from: { path: "^packages/contracts/" }, to: { dependencyTypes: ["npm"], pathNot: "^(zod)(/|$)" } },
    { name: "web-feature-isolation", severity: "error",
      from: { path: `${WEB}/features/([^/]+)/` },
      to:   { path: `${WEB}/features/([^/]+)/`, pathNot: `${WEB}/features/$1/` } },
    { name: "web-shared-below-features", severity: "error",
      from: { path: `${WEB}/shared/` }, to: { path: `${WEB}/features/` } },
    { name: "no-test-code-in-prod", severity: "error",
      from: { pathNot: "(\\.test\\.|^e2e/|^packages/testing/)" }, to: { path: "(\\.test\\.|^packages/testing/)" } },
    { name: "not-to-unresolvable", severity: "error", from: {}, to: { couldNotResolve: true } },
    { name: "not-to-dev-dep", severity: "error", from: { path: "^apps/[^/]+/src", pathNot: "\\.test\\." },
      to: { dependencyTypes: ["npm-dev"] } },
    { name: "no-orphans", severity: "warn", from: { orphan: true, pathNot: "(entrypoints/|\\.config\\.|\\.d\\.ts$)" }, to: {} },
  ],
  options: {
    parser: "tsc", tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" }, exclude: { path: "(^|/)node_modules/|/dist/" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "node", "default"],
                              extensions: [".ts", ".tsx", ".js", ".mjs", ".json"] },
    cache: { folder: "node_modules/.cache/dependency-cruiser", strategy: "metadata" },
  },
};
```
Команды: `depcruise apps packages e2e --config` (проверка), `depcruise … -T dot | dot -T svg` (картинка графа —
пригодится в дипломе). Скорость на реальном репозитории не измерял; у dependency-cruiser есть кэш.

**Рекомендация: dependency-cruiser с обходным путём + страховкой от нулевого результата**, отдельным шагом
`make deps-check` (в хук `pre-push`, не `pre-commit` — это проверка всего графа). Обходной путь снять,
когда выйдет dependency-cruiser с поддержкой TS ≥ 7.1 (проверять changelog при каждом обновлении).
Что изменило бы выбор: если окажется, что граф под TS 6-совместимостью даёт ложные срабатывания на реальном
коде, запасной вариант — `parser: "swc"` (помечен устаревшим, но 18.7.0 его дорабатывал [В]) или
eslint-plugin-boundaries при переходе на ESLint.

**Стыковка.** Требует от бэкенд-исследователя: структура модуля `index.ts/domain/app/infra/http` — иначе
правила придётся переписать; от Docker — ничего.

**Риски.** Регулярные выражения — это «код» со своими ошибками: на каждое правило нужен тест-пример
«должно упасть» (как в моём `p1`: 6 намеренных нарушений) — его стоит положить в `tooling/depcruise-fixtures`.
Дополнительно можно подключить **knip** (6.43) для поиска мёртвого кода и лишних зависимостей [С].

---

## 7. Линтер и форматтер

**Что решаем.** Линтер находит ошибки и опасные конструкции, форматтер единообразно расставляет пробелы
и переносы. Пример: линтер подсветит «забытое `await`» перед вызовом, которое в сценарии агента привело бы
к потерянной записи операции; форматтер избавит ревью от споров о запятых.

### 7.1 Oxlint [В: документация, опыт `p1`/`p2`]

- **Зрелость.** 1.89.0, выпуски еженедельно, 871 встроенное правило (по документации). Работает за доли секунды.
- **Type-aware линтинг стабилен** с 2026-07-22 (tsgolint v7, 59 из 61 типо-зависимых правил typescript-eslint;
  включение `options.typeAware: true` или `--type-aware`; нужен TypeScript ≥ 7, `oxlint-tsgolint@7`) [В: блог Oxc].
  В моём опыте правило `no-floating-promises` сработало, а `oxlint --type-check` показал и ошибку компилятора
  `TS2322` — линт и проверка типов за один проход. Работает и без корневого `tsconfig.json`, и с корневым
  `{"files": [], "references": […]}` (оба варианта дали одинаковый результат) [В]. Ограничения: не поддерживает
  `baseUrl`; опции type-aware работают только в корневом конфиге; на очень больших репозиториях память [В: документация].
- **Плагины, встроенные в Rust:** `react` (включая react-hooks и React Compiler), `jsx-a11y`, `import`
  (в т. ч. `import/no-cycle`), `unicorn`, `vitest`, `node`, `promise`, `jsdoc`, `typescript`, `oxc` [В: документация].
  Включаются в `"plugins": […]`.
- **Не покрыто:** сторонние ESLint-плагины идут только как **JS-плагины в альфе** (без гарантий семвера) [В].
  Например, если ORM = Drizzle, то его ESLint-плагин («delete без where») будет работать в этом режиме.
- **Доступность (NFR-20).** `jsx-a11y` ловит лишь часть проблем; дополнить прогоном **axe** внутри
  Playwright (`@axe-core/playwright`, 4.14.0) [С].
- Конфиг: `.oxlintrc.json` (или `oxlint.config.ts`), вложенные конфиги и `overrides` — для разных папок.

### 7.2 oxfmt [В: документация, опыт `p1`]

- **Зрелость: бета.** Версия **0.74.0**, ещё 0.x; бета объявлена 2026-02-24: проходит 100 % тестов Prettier для JS/TS,
  остаются «поддержка плагинов Prettier, формат встроенного кода, стабильность, скорость» до 1.0 [В: блог Oxc].
  Стабильного релиза пока нет [В: поиск не нашёл].
- **Что умеет:** JS/TS/JSX/TSX, JSON(C/5), YAML, TOML, HTML, CSS/SCSS/Less, Markdown/MDX, GraphQL, Vue…; встроенно:
  сортировка импортов, сортировка классов Tailwind, сортировка полей `package.json` (она включена по умолчанию —
  в моём опыте `oxfmt --check` сразу потребовал поправить `package.json`) [В].
- **Отличия от Prettier:** `printWidth` по умолчанию 100 (не 80), `experimentalTernaries` не поддерживается,
  плагины Prettier не поддерживаются, вложенные `.editorconfig` не читаются [В: документация].
  Режимы: `oxfmt` (запись), `--check` (код возврата 1, если есть что менять), `--list-different`;
  уважает `.gitignore`; принимает список файлов и `--no-error-on-unmatched-pattern` — удобно для хука [В].
- **Миграция с Prettier/Biome** — `oxfmt --migrate=prettier|biome`.

### 7.3 Сравнение и запасные варианты

| Вариант | Плюсы | Минусы | Риск |
|---|---|---|---|
| **Oxlint + oxfmt** | один быстрый стек (VoidZero), type-aware без ESLint, пожелание пользователя | oxfmt — бета; JS-плагины — альфа | формат может слегка меняться между 0.x; решается точной версией и отдельным коммитом «форматирование» в `.git-blame-ignore-revs` |
| Biome 2.6 | линтер **и** форматтер в одном, 500+ правил, Markdown/YAML с 2.6 [В: блог Biome] | другой набор правил; JS-плагины в «developer preview» | смена стека, нет Oxc-type-aware |
| ESLint 10 + typescript-eslint + Prettier 3.9 | самая большая экосистема правил | **typescript-eslint под TS 7 требует `@typescript/typescript6`** (нет API) [В: блог TS]; медленно | хрупко именно в 2026-10 |
| Vite+ 1.4 | одна команда `vp` вокруг Vite, Vitest, Oxlint, oxfmt, tsdown, task runner | ещё один слой над слоями; статус и условия не проверял | привязка к обёртке; без необходимости не брать [Н] |

**Рекомендация: Oxlint (type-aware, с `--type-check` или отдельным `tsc`) + oxfmt**, версии закрепить точно
(без `^`). Конфиг линтера: категория `correctness` = error, плюс включённые `suspicious`-правила и
`typescript/no-floating-promises`, `typescript/no-explicit-any`, `import/no-cycle`; для тестов — `vitest`-плагин.
Запасной вариант — **Biome**: у oxfmt есть `--migrate=biome` (перенос настроек Biome в oxfmt), у Biome — свой `biome migrate`; переход несложный, но правила линтера придётся переписать. Что изменило бы выбор: если oxfmt станет ломать формат между патчами чаще раза в месяц —
перейти на Prettier 3.9 (форматтер отдельно от линтера, Oxlint остаётся).

```jsonc
// .oxlintrc.json (минимум, проверено в p1/p2)
{ "plugins": ["typescript","import","unicorn","oxc","react","jsx-a11y","vitest"],
  "options": { "typeAware": true },
  "categories": { "correctness": "error" },
  "rules": { "typescript/no-floating-promises": "error", "typescript/no-explicit-any": "error", "import/no-cycle": "error" },
  "overrides": [{ "files": ["**/*.test.ts"], "rules": { "typescript/no-explicit-any": "off" } }] }
```
```jsonc
// .oxfmtrc.json (oxfmt --init создаёт заготовку)
{ "printWidth": 100, "ignorePatterns": ["pnpm-lock.yaml", "**/__recordings__/**", "samples/**", "**/generated/**"] }
```

**Стыковка.** Фронт-исследователю: если выбран Tailwind — сортировка классов уже внутри oxfmt. Все: правила
линтера и границ — это «контракт» для ИИ-агентов разработки.

**Риски/вопросы к пользователю.** Принять ли бета-форматтер ради пожелания (я считаю — да, риск малый и
обратимый). Нужны ли строгие правила доступности только статическим линтом (недостаточно — см. axe).

---

## 8. Тестовый стек

**Что решаем.** Какими инструментами писать тесты NFR-11 и QA-01: быстрые, офлайн, детерминированные,
с понятными сообщениями — удобные ИИ-агентам.

| Задача | Рекомендация | Альтернативы | Заметки |
|---|---|---|---|
| Unit/интеграция | **Vitest 5.0.5**, `test.projects` в корне | Jest, `node:test` | Vitest 5 требует Node `^22.12 / ^24 / >=26` и Vite ≥ 6.4; `vitest.workspace` заменён на `projects` [В] |
| Покрытие | **v8** (`@vitest/coverage-v8`) | istanbul | с Vitest 3.2 v8 использует AST-ремаппинг и даёт отчёт, неотличимый от istanbul [В: документация] |
| e2e | **Playwright 1.64** в `e2e/` | Cypress | `webServer` поднимает приложение; демо-данные (DEMO) — готовая фикстура |
| Тестовая БД | **Testcontainers (postgresql) 12.2** | PGlite 0.5 | см. ниже |
| Записанные ответы моделей | собственные «кассеты» на границе слоя LLM | MSW 3, nock 15 (`nock.back`), Polly.js | см. ниже |

**Проверено [В, `p2`]:** `vitest run --coverage` с `projects: ["apps/*","packages/*"]` — тесты пакета и приложения,
импортирующего workspace-пакет напрямую из `.ts`, проходят за 0,4 с; отчёт v8 строится по всем проектам.
Замечание миграции Vitest 5: конфиг пакета не должен наследовать корневой с `projects` — использовать
общий `vitest.shared.ts` + `defineProject` [В: документация].

**Покрытие.** Пороги (`coverage.thresholds`) ставить **только на `packages/domain` и критичные модули**
(калькулятор вычетов, валидатор чека, цитаты) — например 90 % строк и веток [Н]; общий процент по репозиторию
не гнаться (NFR-11: «без лишних»).

**Тестовая БД.** Testcontainers поднимает настоящий Postgres (образ с pgvector) в Docker — полное сходство
с боевой БД (русская морфология, pgvector, pg-boss). Экономия времени: один контейнер на весь прогон
(`globalSetup`), для каждого воркера — своя база через `CREATE DATABASE … TEMPLATE …` [Н, известный приём].
Замечание: **на этой машине демон Docker сейчас не запущен** (`docker info` — нет сокета Docker Desktop) [В];
`make doctor` должен это сообщать. **PGlite** (Postgres 18.6 в WebAssembly, без Docker) проверен: стартует ~2,2 с,
`pgvector` работает, `to_tsvector('russian', …) @@ plainto_tsquery('russian', 'вычет')` — `true` [В, `p3`].
Но это не полный Postgres (набор расширений ограничен; совместимость с pg-boss не проверял), поэтому —
как дополнение для быстрых проверок SQL, а не замена. Окончательный выбор — за исследователем БД.

**Записанные ответы моделей (коротко; глубже — ИИ-слой).** Polly.js не обновлялся с 2023-07 [В] — не берём.
MSW/nock перехватывают HTTP, но запись привязана к формату запросов конкретного SDK (при смене провайдера
в цепочке Groq → Z.ai кассеты ломаются). Предлагаю **писать кассеты на границе собственного интерфейса
LLM-слоя** (запрос в нормализованном виде → хеш → JSON-ответ, для стриминга — массив фрагментов),
режим `RECORD=1` обновляет их (команда `make recordings-update`, QA-17), по умолчанию — только воспроизведение
(промах кассеты = понятная ошибка, не поход в сеть, NFR-11). MSW (3.0.3) оставить для остального HTTP
(курсы НБРБ, страницы pravo.by как HTML-фикстуры). Файлы кассет — в `__recordings__/` (исключены из форматтера
и из подсчёта размера коммита, приложение А).

**Стыковка.** `packages/testing` содержит помощников кассет, фабрики и запуск БД; `e2e` зависит от `make dev-*`;
исследователь ИИ-слоя определяет формат кассет.

**Риски.** Testcontainers без Docker не работает — тесты интеграции должны быть выделены в отдельный проект
Vitest (`test:integration`), чтобы `make test` для чистой логики шёл без Docker.

---

## 9. Git-хуки, Conventional Commits, размер коммита

**Что решаем.** Все требования пользователя к истории (Conventional Commits, заголовок ≤ ~72 символов,
коммиты «не слишком большие и не слишком мелкие») проверяются хуком, а не памятью. Важно: **CI нет**
(публичного хостинга нет, NFR-17), значит хуки + `make check` — единственные ворота. Агенты умеют обходить
хуки через `--no-verify`, поэтому нужен ещё `pre-push` и команда проверки всей истории.

### 9.1 Менеджер хуков

| Вариант | Плюсы | Минусы | Зрелость |
|---|---|---|---|
| **lefthook 2.2.2** | один бинарник на Go, `glob`, `{staged_files}`, `skip: merge/rebase`, параллельность; встроенный аналог lint-staged | нужен `allowBuilds: lefthook: true` в pnpm 12 (иначе хуки не установятся — проверено [В]) | 2026-10-13 |
| husky 9.1.7 | самый популярный, прост | сам по себе фильтрации файлов нет → ещё lint-staged | последняя версия 2026-09-02 |
| simple-git-hooks 2.14 | минимализм | нет фильтров, нет параллельности | — |

**Рекомендация: lefthook** — заменяет и husky, и lint-staged (lint-staged 17.6 не нужен).

### 9.2 Что запускать и когда

| Хук | Что | Бюджет |
|---|---|---|
| `pre-commit` | `oxfmt --check` и `oxlint` по **staged-файлам**; без автоправки | до ~3 с [Н] |
| `commit-msg` | `commitlint` + проверка размера коммита | ~0,6 с [В: замер `p4`] |
| `pre-push` | `make check`-лёгкий: `typecheck --affected`, `deps-check`, `vitest run` | десятки секунд |
| `make check` | всё сразу, вручную и для обхода `--no-verify` | — |

**Почему в `pre-commit` только проверка, без автоисправления:** при частичном добавлении (`git add -p`, а это
основной приём для маленьких атомарных коммитов) `stage_fixed: true` добавляет в коммит **весь** файл целиком,
включая то, что в коммит не собирались. Поэтому хук сообщает «запусти `make fmt`», а не правит сам [Н].

```yaml
# lefthook.yml (синтаксис проверен на 2.2.2, фрагмент pre-commit — по документации)
pre-commit:
  commands:
    fmt:  { glob: "*.{ts,tsx,js,mjs,cjs,json,jsonc,css,md,yml,yaml}", skip: [merge, rebase],
            run: pnpm exec oxfmt --check --no-error-on-unmatched-pattern {staged_files} }
    lint: { glob: "*.{ts,tsx,js,mjs,cjs}", skip: [merge, rebase], run: pnpm exec oxlint {staged_files} }
commit-msg:
  commands:
    commitlint: { run: pnpm exec commitlint --edit {1} }
    size:       { run: node tooling/check-commit-size.mjs {1} }
pre-push:
  commands:
    check: { run: make check-quick }
```

### 9.3 commitlint и Conventional Commits [В, `p4`]

`@commitlint/config-conventional` + свои правила. Проверено: **длина заголовка считается в символах, не байтах**
(русский заголовок в 72 символа проходит, 90 — отклоняется); регистр темы нужно отключить
(`subject-case: [0]` — для русского он бессмыслен). Рабочая конфигурация:

```js
// commitlint.config.js
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 72],
    "header-min-length": [2, "always", 15],            // «fix: ok» — не описание
    "subject-case": [0],                               // русские темы
    "subject-full-stop": [2, "never", "."],
    "scope-enum": [2, "always", ["api","web","worker","bot","shared","domain","ui","config","deps","docs","ci","repo"]],
    "body-max-line-length": [1, "always", 100],
  },
};
```
Типы (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`, `revert`, `style`) — латиницей,
тема — по-русски (в соответствии с правилами каталога). Список `scope-enum` привязать к модулям сервера
(`receipts`, `statements`, `law` …) — тогда новый модуль требует правки конфига, и это полезное трение.

### 9.4 «Не слишком большой / не слишком мелкий коммит»

Что реально можно проверить: число и размер **staged**-изменений. Нельзя проверить «осмысленность» — только
пороги. Моё предложение (написано и проверено на 5 сценариях в `p4`, полный код — приложение А):

- считаем файлы и `добавлено + удалено` строк из `git diff --cached --numstat -M`, **не считая** автогенерацию
  и данные: `pnpm-lock.yaml` (в опыте 3000 строк lock-файла не засчитались), миграционные снимки, `*.snap`,
  `__recordings__/`, `generated/`;
- **крупный**: предупреждение от 400 строк / 20 файлов, **отказ** от 800 строк / 40 файлов [Н; ориентир —
  общеизвестное правило «ревью теряет внимание после ~400 строк» [С]]; откалибровать на первых 20–30
  коммитах репозитория;
- **мелкий**: отказ, если меньше 3 строк, для типов `feat/refactor/test/perf` (для `docs/chore/style/revert`
  и, по моему мнению, `fix` — можно: однострочная правка бага законна) [Н];
- **клапаны для законных исключений**: строка в конце сообщения `Large-Commit: <причина>` (например, «генерация
  справочника», «первый импорт кода») и `Small-Commit: <причина>`; слияния, `revert`, `fixup!/squash!` пропускаются.
  Проверка идёт в `commit-msg`, а не в `pre-commit`, потому что там известны и сообщение (тип, трейлеры), и diff.

Результат прогона [В]: мелкий `feat` на 1 строку — отказ с понятным сообщением; тот же текст с типом `docs` —
проходит; 900-строчный файл — отказ; с трейлером `Large-Commit:` — проходит; коммит с 3000 строк lock-файла и
одной строкой кода — считается одной строкой (отказ как мелкий).

**Рекомендация:** lefthook + commitlint + `tooling/check-commit-size.mjs`; плюс `make check-commits`
(`commitlint --from <первый коммит>`) для проверки всей истории после возможных `--no-verify`. Что изменило бы
выбор: если порог 800 строк окажется мешающим при генерации кода агентами — поднять, а не обходить трейлером.

**Стыковка.** Требует от Makefile целей `check-quick`, `check-commits`, `hooks`. От других областей:
правила `scope-enum` и список исключений должны совпадать с реальными модулями и каталогами данных.

**Риски.** Хуки обходимы (`--no-verify`) — компенсируем `pre-push` и командой проверки истории. Пользователь
не архитектор, поэтому сообщения хука написаны по-русски и говорят, что делать.

---

## 10. Makefile поверх скриптов (NFR-14)

**Что решаем.** Один список команд на все операции: установка, запуск, остановка, тесты, eval, линт, формат,
логи, сброс демо-данных (NFR-14), а также OBS-06 (просмотр логов), QA-10/QA-17 (eval и обновление кассет),
DEMO-03 (пересоздание демо). Принцип: **Makefile — тонкая «входная дверь», вся логика — в `pnpm`-скриптах и
`docker compose`**; в Makefile нет ничего, кроме вызовов (чтобы то же самое работало и без `make`).

| Группа | Цели | Что делают |
|---|---|---|
| Подготовка | `help` (по умолчанию, автоописание из `##`), `doctor`, `install`, `env`, `hooks` | проверка версий Node/pnpm/Docker и, в частности, жив ли демон Docker; `pnpm install --frozen-lockfile` + `lefthook install`; копия `.env.example` при отсутствии |
| Запуск без контейнеров | `dev` (web + api + worker + bot), `dev-web`, `dev-api`, `dev-worker`, `dev-bot`, `db-up`, `db-down` | процессы на хосте; `db-up` поднимает только контейнер Postgres |
| Запуск в контейнерах | `up`, `down`, `restart`, `ps`, `build` | `docker compose up -d --build`, `down`, … |
| Логи | `logs` (OBS-06, с фильтром `S=api`), `logs-pretty` | `docker compose logs -f` или чтение JSON-логов с форматированием |
| Данные | `db-migrate`, `db-reset`, `demo-reset` (DEMO-03), `models-pull` (NFR-25, предзагрузка локальных моделей) | |
| Качество | `fmt`, `fmt-check`, `lint`, `lint-fix`, `typecheck`, `deps-check`, `test`, `test-integration`, `test-watch`, `coverage`, `test-e2e`, **`check`** (fmt-check + lint + typecheck + deps-check + test) и `check-quick` для `pre-push` | `check` — единая «зелёная кнопка» |
| ИИ | **`eval`** (QA-10, `SUITE=receipts|law|statements|categories|agent`), **`recordings-update`** (QA-17) | `eval` ходит в сеть и тратит лимиты — отдельно от `check`, с предупреждением |
| Гигиена | `clean`, `audit` (`pnpm audit`), `deps-graph` (SVG графа для диплома), `check-commits` | |

```make
# Makefile (скелет)
.DEFAULT_GOAL := help
.PHONY: help install dev up down test check eval
help:      ## Показать команды
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
install:   ## Установить зависимости и git-хуки
	pnpm install --frozen-lockfile && pnpm exec lefthook install
dev:       ## Запустить всё на хосте (нужен Postgres: make db-up)
	pnpm dev
up:        ## Запустить всё в контейнерах
	docker compose up -d --build
check:     ## Все проверки: формат, линт, типы, границы, тесты
	pnpm fmt:check && pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test
eval:      ## Проверка качества ИИ (тратит лимиты API!) — SUITE=receipts|law|…
	pnpm eval $(if $(SUITE),--suite=$(SUITE))
```

**Рекомендация:** Makefile + корневые `pnpm`-скрипты с теми же именами; `make help` — единственное, что нужно
помнить. **Открытый вопрос (БД/Docker):** «локально без контейнеров» всё равно требует Postgres с pgvector:
либо ставить его на хост, либо `make db-up` (только БД в контейнере), либо для разработки PGlite (проверено,
§8, но полного сходства нет). Решение — на стыке с исследователем БД и Docker.

---

## 11. Сводные риски и вопросы пользователю

1. **TS 7 слишком свеж?** Он стабилен (7.0.2), но экосистема догоняет: dependency-cruiser требует обходного пути
   (проверен), typescript-eslint не работает без `typescript@6`. Альтернатива — остаться на TS 6.0.x с обычным
   `tsc`, потеряв type-aware Oxlint (ему нужен TS 7) — не рекомендую. **Вопрос:** принимаем TS 7 с обходным путём?
2. **oxfmt в бете.** Принять риск ради пожелания (рекомендую), или Prettier 3.9 как форматтер?
3. **Node 24 сейчас или 26 после 2026-10-28?** Рекомендую 24 → 26 после проверки нативных зависимостей.
4. **Решение про фреймворк бэкенда определяет `erasableSyntaxOnly`.** Если NestJS — теряем запуск `.ts` без
   сборки; заранее согласовать с исследователем бэкенда.
5. **Пороги размера коммита (800/40/3) — мои предложения [Н];** откалибровать на реальных коммитах.
6. **Раскладка А или Б?** (рекомендую А.) Нужно ли выносить `ui` в отдельный пакет (сейчас нет).
7. **Turborepo при маленьком масштабе даёт мало.** Оставить (рекомендую, минимальный конфиг) или обойтись
   pnpm?
8. **Тестовая БД:** только Testcontainers или ещё PGlite для быстрых тестов — согласовать с исследователем БД.
9. **Docker на машине не запущен** (Docker Desktop без сокета) — перед архитектурой Docker это стоит починить.

---

## Итог одним списком

| Решение | Рекомендация | Почему |
|---|---|---|
| Менеджер пакетов | pnpm 12 | строгие зависимости, catalogs, защита цепочки поставки по умолчанию |
| Среда выполнения | Node.js 24 LTS (→ 26 после 2026-10-28), без Bun | Node сам запускает TS; Vitest-покрытие v8 не работает на Bun |
| Оркестрация | Turborepo (минимальный `turbo.json`) | кэш + affected за один небольшой файл; убрать — просто |
| Раскладка | Вариант А: `apps/web`, `apps/server` (api/worker/bot), `packages/{contracts,domain,i18n,testing}`, `e2e` | один человек + агенты; границы проведены внутри сервера, вынос в пакеты — потом |
| TypeScript | 7.0.2, внутренние пакеты без сборки, `erasableSyntaxOnly` | быстро, правка видна сразу, Node 24 запускает `.ts` |
| Сборка для образов | tsdown (один `.mjs` на точку входа) | `pnpm deploy` ломает запуск `.ts` из `node_modules` |
| Линтер | Oxlint (type-aware стабилен) | быстрый, покрывает react/a11y/import/vitest; один проход с проверкой типов |
| Форматтер | oxfmt (бета, версия закреплена) | пожелание пользователя; запасной — Prettier 3.9 / Biome |
| Границы модулей | dependency-cruiser 18 + `typescript@6` рядом + резолвер workspace + страховка от «0 модулей» | иначе под TS 7 проверка молча пуста |
| Тесты | Vitest 5 `projects` + v8, Playwright (+axe), Testcontainers (PGlite — доп.) | всё проверено на этой машине (кроме Docker) |
| Ответы моделей | «кассеты» на границе LLM-слоя; MSW для прочего HTTP; без Polly.js | не зависят от провайдера; Polly не обновлялся с 2023 |
| Git-хуки | lefthook (+ `allowBuilds`), без lint-staged | фильтр staged-файлов встроен |
| Коммиты | commitlint (заголовок ≤ 72, русская тема) + `check-commit-size.mjs` (400/800 строк, мин. 3) + `pre-push` | проверено на 5 сценариях; CI нет — хуки единственные ворота |
| Makefile | тонкая обёртка над `pnpm`/`docker compose`, `check` и отдельный `eval` | NFR-14, QA-10/17, DEMO-03, OBS-06 |

---

## Приложение А. Скрипт проверки размера коммита (проверен в `p4`)

```js
#!/usr/bin/env node
// tooling/check-commit-size.mjs — commit-msg: node tooling/check-commit-size.mjs <файл-сообщения>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LIMITS = { warnFiles: 20, maxFiles: 40, warnLines: 400, maxLines: 800, minLines: 3 };
const EXEMPT = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)drizzle\/meta\/.*\.json$/, /(^|\/)__recordings__\//, /\.snap$/, /(^|\/)generated\//];

const msg = readFileSync(process.argv[2], "utf8");
const header = msg.split("\n", 1)[0] ?? "";
if (/^(Merge|Revert|fixup!|squash!)/.test(header)) process.exit(0);

const trailer = (name) => new RegExp(`^${name}:\\s*\\S+`, "m").test(msg);
const type = /^(\w+)(\([^)]*\))?!?:/.exec(header)?.[1] ?? "";

const out = execFileSync("git", ["diff", "--cached", "--numstat", "-M", "-z"], { encoding: "utf8" });
let files = 0, lines = 0;
for (const rec of out.split("\0").filter(Boolean)) {
  const [add, del, path] = rec.split("\t");
  if (!path || EXEMPT.some((re) => re.test(path))) continue;
  files += 1;
  lines += add === "-" ? 0 : Number(add) + Number(del); // "-" = бинарный файл
}

const fail = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
if (files > LIMITS.maxFiles || lines > LIMITS.maxLines) {
  if (!trailer("Large-Commit")) fail(
    `Коммит слишком большой: ${files} файлов, ${lines} строк (предел ${LIMITS.maxFiles} / ${LIMITS.maxLines}).\n` +
    `  Разбейте на части (git add -p) или добавьте в конец сообщения строку «Large-Commit: <причина>».`);
} else if (files > LIMITS.warnFiles || lines > LIMITS.warnLines) {
  console.warn(`! Коммит крупный: ${files} файлов, ${lines} строк. Подумайте, нельзя ли разбить.`);
}
// "fix" в списке — моё добавление после проверки (в проверенной версии его не было): однострочный фикс законен
const tinyOk = ["docs", "chore", "style", "revert", "fix"].includes(type) || trailer("Small-Commit");
if (files > 0 && lines < LIMITS.minLines && !tinyOk) fail(
  `Коммит слишком мелкий: ${lines} строк (минимум ${LIMITS.minLines}). Объедините с соседним изменением,\n` +
  `  либо используйте тип docs/chore/style/fix, либо добавьте строку «Small-Commit: <причина>».`);
```
Ограничения: при переименовании `git diff --numstat -z` отдаёт пустой путь, а старый и новый — отдельными записями;
сейчас такая запись пропускается (переименование не засчитывается) — для разумных коммитов не критично, но
стоит доработать [Н]; при `git commit -a`/`--amend` staged-diff уже содержит итоговое состояние —
для `--amend` считается только добавляемая часть, что допустимо.

## Источники

- Node.js: расписание выпусков <https://github.com/nodejs/Release/blob/main/schedule.json>; <https://nodejs.org/dist/index.json>
- pnpm: <https://pnpm.io/settings>, <https://pnpm.io/catalogs>, релизы <https://github.com/pnpm/pnpm/releases>
- Turborepo (`--affected`, `futureFlags.affectedUsingTaskInputs`, `inputs`): <https://turborepo.dev/docs/reference/run>, <https://turborepo.dev/docs/reference/configuration>
- TypeScript 7.0: <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>
- Oxlint, type-aware: <https://oxc.rs/docs/guide/usage/linter.html>, <https://oxc.rs/docs/guide/usage/linter/type-aware.html>, <https://oxc.rs/blog/2026-07-22-type-aware-linting-stable>, плагины <https://oxc.rs/docs/guide/usage/linter/plugins.html>, конфиг <https://oxc.rs/docs/guide/usage/linter/config.html>
- oxfmt: <https://oxc.rs/docs/guide/usage/formatter.html>, <https://oxc.rs/blog/2026-02-24-oxfmt-beta>, <https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier.html>, <https://oxc.rs/docs/guide/usage/formatter/unsupported-features.html>
- Vite+ <https://viteplus.dev/guide/>; Biome <https://biomejs.dev/blog/>
- dependency-cruiser: <https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md>, <https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md>, релизы <https://github.com/sverweij/dependency-cruiser/releases>
- Vitest (projects, покрытие): <https://vitest.dev/guide/projects>, <https://vitest.dev/guide/coverage>, миграция на 5 <https://vitest.dev/guide/migration>
- lefthook: <https://lefthook.dev/configuration/>, <https://github.com/evilmartians/lefthook>; commitlint <https://commitlint.js.org/>
- PGlite: <https://pglite.dev/extensions/>; Testcontainers для Node <https://node.testcontainers.org/>
- Версии и даты — `npm view <пакет> version time.modified license` (2026-10-24).
