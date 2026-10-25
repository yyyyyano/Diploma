# План реализации MVP «Кошта»

## Как пользоваться

- Новая сессия в `yana/` → `/task-cycle` (следующая готовая задача), `/task-cycle T-001` (конкретная) или
  `/task-cycle auto [N]` (подряд до точки остановки; без N — до конца текущей фазы). Формат задач и статусов —
  `.claude/commands/task-cycle.md`; статус меняет только дирижёр; задачи идут строго в порядке файла.
- Для всех задач сверх их критериев: `make check` зелёный (хвост вывода — в итоге); для экранов — `make e2e`
  (axe 0 при 1440 и 390 px) и сверка скриншотов с `design/`; паспорта затронутых модулей и фич обновлены; новая
  пользовательская таблица — в `defineUserData` и в тесте изоляции; инструмент агента — `defineTool` с тестом без
  модели; правка `tooling/architecture/modules.ts` — отдельный пункт итога (ARCHITECTURE §15).
- В фазах 3–8 критерии — ключевые проверяемые результаты со ссылками на SPEC и макет; полный список КП критик
  уточняет перед стартом фазы.
- **План не растёт** (решение пользователя 2026-10-25, ADR-0021): новых задач и ID больше не добавляют. Изменение —
  правка существующей задачи (скорректировать, дополнить, перенести критерий, убрать как `dropped`); находка
  «на потом» — критерием в подходящую существующую задачу. T-056…T-061 — последние задачи, появившиеся разрезом.

## Фаза 1 · Бетон

Контрольная точка: `make check` зелёный на всём проекте и красный на намеренной ошибке каждого вида (формат, линт,
типы, тест, граница модулей, изоляция); `make init && make up` на чистой машине → экран первого запуска → вход →
счёт «Наличные» на сайте; чат-заглушка показывает поток, шаг и карточку; `make e2e` зелёный; ревью человеком.
После фазы главная сессия с пользователем калибрует числа **[калибр.]** в `CONSTRAINTS.md` по замерам T-011.

**Решения перед запуском (2026-10-24)** — обязательный вход критика и имплементатора всех задач фазы:

- **Права на команды.** Пользователь сам включил в приложении режим без запросов о правах («делай что хочешь»);
  `.claude/settings.json` не правится. Необратимые цели (`make db-reset`, `make restore`) запускать только на
  одноразовых данных и только внутри проверки этих целей.
- **Node 26.** Установлен через nvm по просьбе пользователя: Node v26.12.1 (npm 11.20.0), `nvm alias default` = 26,
  pnpm 12.15.0 стоит глобально под Node 26. В среде приложения `PATH` унаследован с Node 24 впереди, поэтому в каждой
  Bash-команде, которой нужны `node`, `pnpm`, `make` или `git commit` (хуки берут `node` из `PATH`), начинай с
  `export PATH="$HOME/.nvm/versions/node/v26.12.1/bin:$PATH"`. Обычный терминал пользователя берёт 26 сам.
  Ключи API в фазе 1 не нужны; `docker ps` доступен без `sudo`.
- **Запасной путь чата (T-010).** Если поток агента через oRPC на AI SDK 7 не заработает, имплементатор не
  останавливается: он сам пишет ADR и делает маршрут Hono `/api/chat` по ARCHITECTURE §8.3 и §15, ревьюер проверяет.

**Решено без пользователя (2026-10-24)** — пользователь может пересмотреть:

- Задачи T-002, T-006 (и новая T-061) и T-010 по определению риска относятся к `high` (замок изоляции, сигналы между домохозяйствами,
  инвариант `cloudAllowed`): фиксер на них сразу Opus. Текст T-006 и T-010 не менялся; в T-002 поле «Риск» исправлено
  в тексте (см. ниже).
- `plan` добавляется в служебные области `scope-enum` commitlint и в список областей корневого `CLAUDE.md` одним
  коммитом T-001: без этого коммиты дирижёра `docs(plan): …` отклонит хук с фазы 2.
- Текст T-002 уточнён по ответу критика (REVISE, правка обратимая, коммит `docs: уточнить задачу T-002 в плане`):
  `tables` вместо булевых `userData`/`systemTables`; список правил границ дополнен правилами ADR-0014 и
  ARCHITECTURE §4.2 (`no-circular`, `not-to-unresolvable`, слои модуля, `web-layers-down`, `web-feature-isolation`,
  `web-routes-thin`, `ui-is-presentational`, `server-not-to-web`), смысл `admin-no-user-data` зафиксирован явно;
  добавлены `floor.mjs` («Пол» CONSTRAINTS, закрывает R1-4 из T-001) и цель `make static-checks` в `check`;
  фикстуры исключены из tsc/oxlint/oxfmt/vitest/`deps-check`; `Риск: high`.
- Критик на раунде 2 счёл T-002 слишком крупной для одного ревью (около 35 правил с фикстурами, 6 скриптов, 7 конфигов)
  и предложил разрез; принято (обратимо): критерий «Свои проверки» (`isolation`, `no-raw-colors`, `calc-no-clock`,
  `floor`, JSX-литералы, `bundle-size`, цель `make static-checks`) вынесен в новую **T-056** (`Риск: high`,
  зависит от T-002); по файлу она стоит сразу после T-002, до T-003. Номер T-056 — потому что номера не
  переиспользуются и не перенумеруются; задач в плане теперь 56.
- Критик T-003 (REVISE) счёл её слишком крупной (5 пакетов, около 60 файлов) и неопределённой по форме; принято
  (обратимо): T-003 сужена до `kernel`, `calc`, `testing` с уточнёнными критериями (правила округления, подключение
  покрытия в `vitest.config.ts` и Makefile, резолв `@kosht/*`, `Clock` и `FakeClock`, бренды на `z.$brand`), контракт
  и тексты вынесены в новую **T-057** (по файлу — после T-003, до T-004; `Риск: high`); зависимости T-005 и T-008
  дополнены T-057. Задач в плане теперь 57.
- Критик T-005 (REVISE) счёл её слишком крупной (8 папок `platform`, HTTP, три процесса, первая боевая схема, около
  7 новых пакетов) и нашёл недостижимые проверки (канарейка логов через `redact`, CSRF и `Host`); принято (обратимо):
  T-005 сужена до платформы без сокетов, HTTP и три процесса вынесены в новую **T-059** (после T-005), а роль
  приложения без суперпользователя БД (находка ревью T-058: `kosht` — суперпользователь, читает файлы сервера) — в
  новую **T-060** (до T-006, чтобы pg-boss знал роли с самого начала); зависимости T-006 и T-009 дополнены. Задач в
  плане теперь 60. Пакеты `hono`, `@hono/node-server`, `@orpc/server`, `@orpc/openapi`, `pino`, `pino-roll`,
  `pino-pretty` названы в ADR-0005 и ADR-0010 и поэтому одобрены планом; версии — точные, через `catalog:`.
- Критик T-006 (REVISE) разрезал её (jobs + events + роль pg-boss и отдельно realtime + SSE) и уточнил текст; принято
  (обратимо): T-006 — фоновые задачи и события (`ScopeVerifier`, `defineEvent`, `policy: 'short'`, схема `pgboss`
  ставится владельцем до `ensureAppRole`), новая **T-061** — живые сигналы (`NOTIFY`/`LISTEN`, `events.stream`); `background_job_run`
  — `systemTable` без владельца; T-007 и T-008 зависят от T-061, в T-009 добавлен критерий «`identity` регистрирует
  `ScopeVerifier`». Задач в плане теперь 61.
- T-005 (критик, раунд 2; обратимо): правило `drizzle-and-pg-only-in-db` получает узкое исключение для схем и
  репозиториев платформы `platform/{settings,secrets,rate-limit}/(schema|*.repo).ts` (по образцу исключения для
  `packages/testing/db`), схемы `platform/*/schema.ts` видят только своя папка, `drizzle.config.ts` и тесты; таблицы
  `settings`, `secrets`, `rate_limit` — `systemTable` платформы, `modules.ts` не меняется; строка CONSTRAINTS «`drizzle-orm`
  и `pg` вне …» должна быть поправлена пользователем. Откат: убрать исключение и вынести репозитории в `platform/db`.
- Критик T-057 (REVISE) заменил расплывчатые критерии проверяемыми; принято (обратимо): точный формат `formatMoney`
  и дат, форма контракта (`pickErrors`, `events.stream`, `PageContext`), правило `i18n-allowed-deps`; проверка
  «каждый ключ трассы `calc` имеет подпись в `formulas`» в T-057 сужена до `fin.freeBalance`, общий реестр ключей
  перенесён в T-014 (панель «Откуда эта цифра?»).
- По ревью T-002 (R1-1, R1-4) в критерии T-004 добавлен пункт: файлы возможностей `platform/db` согласованы с
  `PLATFORM_DB` в `rules.ts`, а правило `drizzle-and-pg-only-in-db` пускает `packages/testing/db` — так буква
  CONSTRAINTS согласуется с ARCHITECTURE §12, где шаблонной БД нужен `pg` (обратимо; если исключение нежелательно —
  вернуть правило и убрать `pg` из `@kosht/testing`).

**Решения пользователя по ходу фазы (2026-10-24/25):**

- T-004: лимит «3 ревью и 2 правки» превышен с согласия пользователя (правки 3 и 4, ревью 4 и 5). После ревью 5
  выбрано: закрыть R5-1 и R5-2 ещё одной правкой, затем ревью 6; новые находки того же класса («аудитор читает
  не так, как Postgres», нужен рукописный сырой SQL) принимаются с записью причины и не блокируют; замена
  регулярок настоящим разборщиком PostgreSQL вынесена в новую **T-058** (по файлу — сразу после T-004; новая
  зависимость по ней — решение пользователя). Задач в плане теперь 58.
- T-058 (2026-10-25): пользователь выбрал парсер `libpg-query` 18.x и включил в задачу булев анализ дерева («предикат
  есть, а выборку не сужает»); если ревью выйдет за лимит — разрез: T-058 парсер с прежним поведением, новая T-059
  булев анализ и JOIN. Ошибки текста задачи, найденные критиком (ADR-0018 занят — берётся ADR-0019; в ADR-0006
  раздела «Чего аудитор не видит» нет), исправлены.
- **Общее распоряжение пользователя (2026-10-25): «ничего меня не спрашивай, иди автоматически».** С этого момента `auto`
  не задаёт вопросов: при исчерпании лимита ревью, `ASK_USER` и выборе зависимости дирижёр берёт рекомендованный
  обратимый вариант и записывает его в «Решено без пользователя»; сверх лимита допускается до 3 дополнительных кругов
  правка+ревью на задачу, затем задача принимается с записью причины. Запреты остаются (`git push`, необратимые
  действия, правки `.claude/**` и `CONSTRAINTS.md` ролями).

### T-001 · Ворота качества: монорепозиторий, проверки, хуки git и Makefile
- Статус: done · 1a5faab..1191080
- Модули: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tooling/tsconfig.base.json`, `.oxlintrc.json`,
  `.oxfmtrc.json`, `lefthook.yml`, `commitlint.config.ts`, `tooling/check-commit-size.mjs`, `tooling/git-hooks/`,
  `Makefile`, `.env.example`
- SPEC: NFR-10, NFR-13, NFR-14, NFR-17
- Критерии приёмки:
  - [ ] Node 26 LTS, pnpm 12 (`catalog:`, `minimumReleaseAge`, `allowBuilds`), минимальный Turborepo;
    `tooling/tsconfig.base.json` с флагами ADR-0002 (`nodenext`, `strict`, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, …); TS 7, Oxlint (type-aware,
    плагины из CONSTRAINTS «Линт»), oxfmt — точные версии.
  - [ ] Makefile: `help` (строки `##`), `install`, `init` (`.env` из `.env.example`, установка хуков lefthook), `fmt`,
    `fmt-check`, `format-file FILE=…` и `lint-file FILE=…` (неподдерживаемые типы файлов молча пропускают, ≤ 3 с на
    файл), `lint`, `typecheck`, `test`, `check`, `check-quick`, `check-commits` (коммиты ветки относительно `main`).
    Остальные цели корневого `CLAUDE.md` добавляют задачи, которые дают их функцию, — без целей-заглушек.
  - [ ] lefthook: `pre-commit` — `oxfmt --check` и `oxlint` по staged без автоправки (≤ 3 с); `commit-msg` — commitlint
    (Conventional Commits, заголовок 15–72, `subject-case` выкл., `scope-enum` — служебные области, id модулей
    добавит T-002) + `check-commit-size.mjs` (предупреждение от 400 строк / 20 файлов, отказ от 800 / 40 без
    `Large-Commit:`; < 3 строк — только `docs/chore/style/fix/revert` или `Small-Commit:`; lock-файл, снимки
    миграций и кассеты не считаются) + `tooling/git-hooks/check-no-ai-attribution.mjs` — всё вместе ≤ 1 с;
    `pre-push` — `make check-quick`.
  - [ ] `make check` зелёный на пустом проекте и красный на намеренной ошибке каждого вида: формат, линт, тип,
    падающий тест (выводы — в итоге задачи, ошибки откатаны).
  - [ ] Хук `commit-msg` отклоняет с понятным сообщением: строку `Co-Authored-By: Claude …`, заголовок из 80 символов,
    коммит на 900 добавленных строк без трейлера; у `check-commit-size.mjs` и `check-no-ai-attribution.mjs` — тесты
    на фикстурах.
  - [ ] `.env.example` — все переменные с безопасными умолчаниями и комментариями; `.gitignore` покрывает
    `secrets/`, `data/`, `models/`, `samples/`, `.env*` (кроме `.env.example`).
- Проверка: make check; make check-commits; pnpm vitest run tooling; вручную: три запрещённых коммита отклонены,
  время `pre-commit` и `commit-msg` замерено
- Риск: medium — на этих воротах держится вся планка; сломанный хук молча пропускает плохие коммиты
- Зависимости: —

### T-002 · Архитектура как код: карта 36 модулей, правила границ и `deps-guard`
- Статус: done · d77da67..2d1b06d
- Модули: `tooling/architecture/modules.ts`, `.dependency-cruiser.mjs`, `tooling/checks/`,
  `tooling/architecture/fixtures/`, `docs/CAPABILITIES.md`, `commitlint.config.ts`, `Makefile`, `package.json`,
  `pnpm-workspace.yaml`, `vitest.config.ts`, `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`
- SPEC: NFR-10, NFR-13, ROLE-01, SEC-04, NFR-19, DES-01, P1
- Критерии приёмки:
  - [ ] `modules.ts` — 36 модулей (`id`, `tier`, `dependsOn`, `tables: ("user" | "system" | "public")[]`, а также
    требования, ответственность и публикуемые события) ровно как в `docs/CAPABILITIES.md`: из `tables` выводятся
    `userData` (есть `user`) и `systemTables` (есть `system` или `public`); столбцы SPEC, «Ответственность»
    и «Публикует» хранятся дословными строками, чтобы diff генерации был пуст; тест: 36 id в kebab-case, нет циклов,
    зависимости только своего или нижнего яруса.
  - [ ] `make capabilities` генерирует таблицы ярусов в `docs/CAPABILITIES.md` (остальной текст файла сохраняется);
    прогон на чистом дереве не меняет смысл таблиц (`git diff docs/CAPABILITIES.md` — пусто или только формат,
    объяснённый в итоге); `scope-enum` commitlint генерируется из `modules.ts` + служебные области корневого
    `CLAUDE.md` (нет строки со служебными областями — понятная ошибка); шапка `docs/CAPABILITIES.md` сообщает
    «таблицы генерируются, не править».
  - [ ] `.dependency-cruiser.mjs` генерируется из карты при загрузке (закоммиченной копии правил нет): `no-circular`,
    `not-to-unresolvable`, `module-public-api-only`, `deps-of-<id>`, ярусы, слои модуля (`domain-is-pure`, `api-thin`,
    `infrastructure-not-to-application`, ARCHITECTURE §4.2), `platform` не импортирует модули, `server-not-to-web`,
    `web-not-to-server`, `web-only-shared-packages`, `web-layers-down`, `web-feature-isolation`, `web-routes-thin`,
    `ui-is-presentational` (ADR-0014), `calc-only-kernel`, `kernel-only-zod`, зависимости `contract`,
    `schema-only-in-infrastructure`, `no-cross-module-repo`, `no-unsafe-db`, `cross-tenant-only-in-sweeps`,
    `system-db-only-for-flagged-modules`, `admin-no-user-data` (admin не импортирует `infrastructure/db` ни одного
    модуля и ходит в чужие модули только через `index.ts`), `testing` не в боевом коде, ограничения библиотек
    (`@ai-sdk/*`, `ai`, `pg-boss`, `grammy`, `drizzle-orm`/`pg`, `@orpc/server`) — по CONSTRAINTS «Архитектурные
    запреты»; запреты сопоставляют и имя из импорта, и путь pnpm (`node_modules/.pnpm/…/node_modules/<пакет>/`),
    unit-тест регэкспов — на строках путей обеих раскладок; `typescript@6` рядом через `packageExtensions`.
  - [ ] Для **каждого** правила — фикстура нарушения и тест «правило ловит своё»: тест гоняет правило отдельно
    (`forbidden: [правило]`) и проверяет, что сработало именно оно; чистая фикстура проходит. Фикстуры исключены
    из `tsc`, oxlint, oxfmt, vitest и `deps-check` (правка конфигов планки — только это исключение, пороги
    не меняются; в итог).
  - [ ] `tooling/checks/deps-guard.mjs`: проверено меньше `MIN_MODULES` файлов → код 2, неразрешённый импорт → код 1
    (корни — только существующие из `apps packages e2e tooling`; порог — по реально существующим файлам, число —
    в итог; T-007 поднимает его).
  - [ ] `make deps-check` ≤ 10 с, входит в `check` и `check-quick`; намеренный импорт мимо `index.ts` делает
    `make check` красным.
- Проверка: make check; make deps-check (время — в итоге); pnpm vitest run tooling; make capabilities && git diff --stat docs/CAPABILITIES.md
- Риск: high — правило, которое молча ничего не ловит, обнуляет статический замок изоляции (ARCHITECTURE §15)
- Зависимости: T-001

### T-056 · Свои проверки: изоляция, цвета, часы в `calc`, «Пол», литералы JSX, бюджет бандла
- Статус: done · a15b214..74fe278
- Модули: `tooling/checks/`, `tooling/architecture/fixtures/`, `Makefile`
- SPEC: ROLE-01, SEC-04, NFR-19, DES-01, P1
- Критерии приёмки:
  - [ ] Свои проверки с тестами на фикстурах, кодом 0/1 и сообщением «что и где исправить»: `isolation.mjs`
    (`makeScope`/`as Scope` вне входов, `sql.raw`/`.execute` вне `infrastructure/db`, `$client`/`unsafeRaw`,
    `userId`/`householdId` во входной схеме процедуры, инструмента и в нагрузке задачи, `db.query.*`),
    `no-raw-colors.mjs` (`#hex`, `rgb(`, `hsl(`, числовые padding/margin/radius в `style`), `calc-no-clock.mjs`
    (`Date.now`, `new Date()` без аргументов, `Math.random`, `Intl`), `floor.mjs` («Пол» CONSTRAINTS: `it.fails`,
    `*-disable` без причины, `TODO` без ID, `Not implemented`), проверка литералов текста в JSX и `bundle-size.mjs`
    (бюджеты CONSTRAINTS; проверяется на фикстуре `dist`, в `check` не входит — `check-full` добавит T-011); цель
    `make static-checks` (isolation, no-raw-colors, calc-no-clock, jsx-literals, floor) входит в `check`; допустимые
    места `makeScope`/`as Scope` и пути `platform/db` (unsafe, cross-tenant, system) — константы вверху скриптов,
    список — в итог (T-004, T-005, T-006, T-052 уточнят).
- Проверка: make check; make static-checks; pnpm vitest run tooling
- Риск: high — скрипт, который ничего не ловит, снимает замок изоляции (ARCHITECTURE §15)
- Зависимости: T-002

### T-003 · Деньги, даты и трасса расчёта: kernel, calc, помощники тестов
- Статус: done · 9b55b2a..7cb531a
- Модули: `@kosht/kernel`, `@kosht/calc`, `@kosht/testing`, `vitest.config.ts`, `Makefile`, `package.json`,
  `pnpm-workspace.yaml`
- SPEC: P1, P2, EXPL-02, FIN-20, NFR-23
- Критерии приёмки:
  - [ ] `kernel`: `Money { minor, currency }` (`minor` — целое в безопасном диапазоне, валюта — код из трёх заглавных
    букв; операция над разными валютами — ошибка), `LocalDate` (Минск; `Intl` — только в
    `LocalDate.fromInstant(instant, tz)`, часовой пояс — настройка, NFR-23), `Period` (включительные границы
    `LocalDate`, записать в паспорте), `Clock` (интерфейс `now()`, `today()`), бренды `UserId` / `HouseholdId` /
    `TraceId` на `z.$brand`, `TraceNode`; `Scope { userId, householdId }` с брендом литералом не собирается (тест
    с `@ts-expect-error` и комментарием), создаётся только `makeScope`; зависимости — только `zod`.
  - [ ] `calc`: `Calc<T> = { value, trace }`, помощники `node/sum/sub/mul/avg/round`; правила округления перечислены
    (направление для половин и отрицательных значений, форма ставки — по `.claude/rules/calc.md`), тесты на
    отрицательные и половинные значения; `freeBalance` — тест-пример FIN-20 «2 400 − 180 − 35 − 1 200 − 145 =
    840 BYN» с трассой из пяти слагаемых и ключом `fin.freeBalance`; fast-check: порядок слагаемых не меняет итог,
    `sub(sum(a, b), b) = a`, разбиение целого на части в сумме даёт целое.
  - [ ] `testing`: `FakeClock implements Clock`, фабрики примитивов.
  - [ ] Покрытие: `coverage.include` для `packages/{calc,kernel}/src/**`, `coverage.thresholds` по glob — `calc` строки
    ≥ 95 %, ветви ≥ 90 %; `kernel` ≥ 90 % / 85 %; `make test` запускает с покрытием; красное на поднятом пороге
    проверено; время `make check` — в итог (бюджет 120 с).
  - [ ] Пакеты подключены в workspace; `@kosht/kernel` из `calc` резолвится в `packages/kernel/src/index.ts` (не
    `couldNotResolve`); `make deps-check` зелёный и красный на намеренном импорте мимо правил; паспорта
    `packages/{kernel,calc,testing}/CLAUDE.md` по `docs/templates/package-passport.md`.
- Проверка: make check; pnpm vitest run packages
- Риск: high — деньги, округление и трасса лежат под каждым числом, которое увидит пользователь
- Зависимости: T-002

### T-057 · Контракт и тексты: contract, i18n
- Статус: done · a1ef23a..7b34021
- Модули: `@kosht/contract`, `@kosht/i18n`, `pnpm-workspace.yaml`, `tooling/architecture/rules.ts`
  (+ фикстура правила)
- SPEC: NFR-19, NFR-23, DES-17, P1
- Критерии приёмки:
  - [ ] `contract`, каталог ошибок: 8 базовых кодов (`VALIDATION` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403,
    `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429 `retryable`, `INTERNAL` 500, `UNAVAILABLE` 503 `retryable`);
    помощник `pickErrors(...codes)` выдаёт карту ошибок oRPC со статусом и схемой `data = { requestId, params }`;
    тип `ErrorCode`, `retryable` читается из каталога; процедура не может объявить код вне каталога (тест).
  - [ ] `contract`, общие схемы: `Money` и `LocalDate` реэкспортируются из `kernel`, а не дублируются; `PageNumber` —
    целое ≥ 1, `PageSize` — 1..100 (по умолчанию 50), `RowCount` — целое ≥ 0; тесты на границы 0, 1, 100, 101.
  - [ ] `contract`, процедуры: `system.health` без входа и без ошибок, ответ `{ status: "ok" }` (`/healthz` не
    заменяет; доступ `publicProc` ставит T-005 на сервере, в паспорте контракта это сказано); `events.stream` — поток
    событий `progress` (сущность, id, доля 0..100 или без неё) и `changed` (сущность, id), без данных; `PageContext` —
    `{ route, params, selected? }` со строгими `.max()`; части сообщений чата — `text`, `step`, `card` (`card` пока
    `{ kind, id }`), расширения — в T-006, T-010 и T-043; зависит только от `zod`, `@orpc/contract`, `kernel`; ключей
    `userId` / `householdId` / `ownerId` в контракте нет (`isolation.mjs` зелёный). Если для маршрутов или потока
    нужен `@orpc/server` или `@orpc/openapi` (в v2 `route` заменён на `.meta(openapi(...))`) — `ESCALATE`, а не
    расширение правила `contract-allowed-deps`; версия `@orpc/contract` — точная, через `catalog:`; итог проверки
    oRPC — в итог задачи.
  - [ ] `i18n`: `i18next` (точная версия через `catalog:`), `createT` без React, словари ru `common`, `errors`,
    `formulas`, `tools`; ключи типизированы (тест с `@ts-expect-error`); множественные числа (`_one/_few/_many/_other`)
    проверены на 0, 1, 2, 5, 11–14, 21, 22, 25, 101, 111 и на дробь.
  - [ ] `i18n`, форматы: `formatMoney({ minor, currency })`: `123456` → `1 234,56 BYN`, `-84000` → `−840,00 BYN`,
    `-5` → `−0,05 BYN`, `0` → `0,00 BYN`, `100000000` → `1 000 000,00 BYN`, `Number.MAX_SAFE_INTEGER` без потери
    цифр; пробелы между разрядами и перед кодом — U+00A0, минус — U+2212, десятичная запятая, каждый символ
    проверяется кодом; десятичная строка собирается из `minor` через `BigInt` (без деления в float), код валюты
    дописывается руками; `formatDate(LocalDate)` → `21.10.2026` без `Intl`; `formatRelativeDay(date, today)`: сегодня,
    вчера, завтра, послезавтра, «через N дн.» и «N дн. назад» до ±7 дней, дальше `formatDate`; тесты на переход через
    границу месяца и года; часовой пояс — только в `LocalDate.fromInstant` (`Europe/Minsk`).
  - [ ] Тесты соответствия: у каждого `ErrorCode` есть текст в `errors` (`satisfies Record<ErrorCode, string>` и
    проверка по данным), у ключа `fin.freeBalance` — подпись в `formulas` (`calc` импортируется только в тесте;
    общий реестр ключей трассы — в T-014); правило `i18n-allowed-deps` в `rules.ts` (`i18n` → только `kernel`,
    `contract`, `i18next`; в тестах разрешён и `calc`) с фикстурой и тестом «ловит своё».
  - [ ] Пакеты подключены в workspace; паспорта `packages/{contract,i18n}/CLAUDE.md` по
    `docs/templates/package-passport.md`.
- Проверка: make check; pnpm vitest run packages
- Риск: high — `formatMoney` показывает каждую сумму, а каталог ошибок — каждую ошибку
- Зависимости: T-003

### T-004 · База данных и изоляция: `ScopedDb`, аудитор SQL, виды таблиц и миграции
- Статус: done · 31961e8..192fd18
- Модули: `platform/db`, `apps/server/drizzle`, `@kosht/testing`, `compose.yaml`
- SPEC: ROLE-01, SEC-04, PRIV-07, NFR-01
- Критерии приёмки:
  - [ ] `compose.yaml`, сервис `db`: PostgreSQL 18 + pgvector с точным тегом, `127.0.0.1:5440`, том в
    `/var/lib/postgresql`, healthcheck; цели `db-up`, `migrate`, `db-generate`, `db-shell`, `test-int`; `check`
    и `test-int` сами поднимают БД, если она не запущена.
  - [ ] Первая ручная миграция — расширения `vector` и `pg_trgm`; миграции при старте под `pg_advisory_lock` (тест:
    два параллельных старта — применяет один, второй ждёт); `schemaFilter: ["public"]`; `casing` drizzle-kit
    и `ON DELETE SET NULL (col)` на составном FK проверены на реальной тестовой схеме (ARCHITECTURE §15).
  - [ ] `userOwnedTable` / `systemTable` / `publicTable` / `ownedFk` по ARCHITECTURE §6.1 (PK `(household_id, id)`,
    `uuidv7()`, составной FK + индекс); `ScopedDb` по §6.3 (`own`, `insert` не принимает `householdId`/`userId` —
    проверено типом, `update`, `delete`, `transaction` с SAVEPOINT); `SystemDb`, `crossTenant` (только для
    `defineSweep`), `unsafeRaw` (миграции и тесты).
  - [ ] Аудитор в `Logger` Drizzle (версия закреплена точно), канарейки: забытый `where`, JOIN без `own` у второй
    таблицы, подзапрос, CTE, агрегат, сырой `sql`, UPDATE/DELETE по id, INSERT с чужим `household_id`, `SystemDb`
    к пользовательской таблице → `ISOLATION_VIOLATION`, запрос до БД не доходит; сообщение называет таблицу
    и что добавить; правильный запрос проходит.
  - [ ] Проверка схемы (int-тест): `VIEW`, функции и триггеры над пользовательскими таблицами, таблица
    с `household_id` вне реестров, nullable `household_id` — красный тест.
  - [ ] `@kosht/testing`: шаблонная БД на тестовый файл (время создания — в итоге, ориентир ~20 мс), `makeScope`
    для тестов.
  - [ ] Возможности `SystemDb`, `crossTenant` и `unsafeRaw` лежат в `platform/db/` отдельными файлами и
    импортируются напрямую, без общего `index.ts`; имена файлов совпадают с `PLATFORM_DB` в
    `tooling/architecture/rules.ts` (тест T-002 краснеет при расхождении), новые пути правятся в `rules.ts`;
    правило `drizzle-and-pg-only-in-db` пускает `packages/testing/db` (шаблонная БД, ARCHITECTURE §12) —
    исключение вносится в `rules.ts` вместе с фикстурой, причина — в итог.
- Проверка: make check; make test-int; pnpm vitest run apps/server/src/platform/db
- Риск: high — изоляция данных: забытый фильтр означает утечку чужих финансов
- Зависимости: T-003

### T-058 · Аудитор SQL по настоящему разбору: парсер PostgreSQL вместо регулярок
- Статус: done · a9eda6f..e8362eb
- Модули: `apps/server/src/platform/db` (`audit.ts`, тесты, паспорт), `apps/server/package.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tooling/architecture/rules.ts` (+ фикстура), `docs/adr/`
- SPEC: ROLE-01, SEC-04, PRIV-07
- Критерии приёмки:
  - [ ] Решение пользователя (2026-10-25): парсер — `libpg-query` 18.x (WASM, грамматика PostgreSQL 18); точная версия
    через `catalog:` с учётом `minimumReleaseAge`; размер, лицензия и наличие postinstall — в итог (без `allowBuilds`,
    если postinstall нет); выбор оформляется ADR-0019 (в ADR-0006 — только строка-ссылка); правило границ
    «`libpg-query` только в `platform/db`» с фикстурой и тестом «ловит своё».
  - [ ] Аудитор берёт таблицы (`RangeVar`, схема и каталог), предикаты `household_id`, цели `SET`, `INSERT … VALUES`,
    `MERGE`, CTE и подзапросы из дерева запроса, а не из регулярок; регулярный разбор удалён из `audit.ts`; остаются
    белый список команд (по тегу узла верхнего уровня) и чистая функция `(sql, params, режим)`; ошибка парсера —
    отказ (`UNPARSEABLE_SQL`), текст ошибки парсера в сообщение не попадает (OBS-04).
  - [ ] Булев анализ дерева: засчитываются конъюнкты `WHERE` и `ON`; `OR` — только если сужает каждая ветка; `NOT`,
    `CASE`, `filter (where …)` и список выбора не считаются; `ON` внешнего соединения сужает только таблицу
    с nullable-стороны; неквалифицированный предикат допустим при единственной пользовательской таблице в области;
    значение `$n` по-прежнему сверяется со `scope.householdId` на каждом вызове. Канарейки: `OR true`,
    `NOT household_id = $1`, внешний JOIN, коррелированный подзапрос, `x IS DISTINCT FROM household_id = $1`,
    `filter (where household_id = $1)`.
  - [ ] Все канарейки утечки T-004 (`audit.test.ts`, `LEAKS`, `audit-differential.int.test.ts`) проходят без
    ослабления; канарейки на ложные срабатывания (`U&"…"`, алиас колонки = имя таблицы, `FOR UPDATE OF`) меняются
    законно, каждое изменение — с причиной в итог; в дифференциальный тест добавлена проверка «каждый вариант,
    принятый Postgres, принимает и парсер»; на зёрнах 7, 11, 12 при `AUDIT_DIFF_RUNS=800` промахов 0.
  - [ ] Базовые числа замеряются на `main` до правки (ложные срабатывания дифференциального теста — около 1000 на
    28 тыс. вариантов; время аудита одного непрокэшированного запроса) и сравниваются после: ложные срабатывания
    не растут, время аудита — в итог (бюджет — в паспорте).
  - [ ] Шапка `audit.ts`, паспорт `platform`, ARCHITECTURE §6.2 и §15: «Чего аудитор не видит» пересмотрен по факту.
- Проверка: make check; make test-int; полный прогон дифференциального теста (`AUDIT_DIFF_RUNS=800`)
- Риск: high — главный замок изоляции данных
- Зависимости: T-004

### T-005 · Платформа сервера, часть 1: конфигурация, логи, ошибки, часы, файлы, настройки, секреты, лимиты частоты
- Статус: done · 53c6843..5477fee
- Модули: `platform/{config,logging,errors,clock,blob-store,settings,secrets,rate-limit}`,
  `apps/server/{drizzle,drizzle.config.ts,package.json}`, `pnpm-workspace.yaml`, `Makefile`, `.env.example`,
  `apps/server/src/platform/CLAUDE.md`, `@kosht/testing`
- SPEC: NFR-15, NFR-16, NFR-23, OBS-01, OBS-02, OBS-04, OBS-06, SEC-02
- Критерии приёмки:
  - [ ] `config`: Zod; `process.env` читают только `config` и точки входа; `loadDbConfig` (его берут `migrate-cli`,
    `globalSetup` тестов и `loadConfig`), `dbConfigFromEnv` из `connection.ts` удалён; неверная или отсутствующая
    переменная, нет или не 32 байта `secrets/master.key` → падение с именем переменной и ожиданием (тест на каждый
    случай); параметры: порты и хосты слушателей, `TRUSTED_ORIGINS`, `DATA_DIR`.
  - [ ] `logging`: pino + `AsyncLocalStorage` (`requestId`, `uid`, `source`); поля — белый список (типом и в
    runtime, чужие отбрасываются); сообщение обязано быть ключом `^[a-z]+(\.[a-z0-9-]+)+$`; `scrub()` вычищает
    email, номер карты (Луна), IBAN BY; для ошибок pg пишутся `code`, стек и `scrub(message)`; канарейки: email,
    номер карты, сумма, текст документа, `new Error` со значением строки; файл на роль
    `data/logs/<role>.<yyyy-MM-dd>.<n>.log`; `pino-roll` как поток в процессе (не `pino.transport`: сборка в один
    `.mjs`, T-011), `frequency: daily`, `limit.count: 13` (14 файлов на роль, проверка — тест параметров); цели
    `logs`, `log-find id=…` (тест на фикстурных логах).
  - [ ] `errors`: `AppError(code ∈ ERRORS, params ∈ ErrorParams)` и чистая `toErrorBody(err, requestId)` →
    `{ code, status, data: { requestId, params } }`; `ISOLATION_VIOLATION` и всё неизвестное → `INTERNAL` без
    текста, стек — в лог.
  - [ ] `clock` по настройке пояса (по умолчанию Минск; неверный пояс отвергается): `2026-10-21T21:30Z` →
    `today()` = `2026-10-22`; `blob-store`: `local-fs`, путь из двух uuid-брендов (`FileId` объявлен здесь), `../`
    отвергается, запись через tmp+rename, режим 0600; `MemoryBlobStore` в `@kosht/testing`.
  - [ ] `settings` (`systemTable`, без домохозяйства) и `secrets`: `defineSetting` с приоритетом «админка > env >
    умолчание» (int-тест); кэш ≤ 5 с; секрет — AES-256-GCM, AAD = имя, свежий IV; наружу «задан / не задан»; чужой
    ключ или повреждение → статус «не читается», процесс не падает; значение не встречается в логах и ответах
    (канарейка); `make init` создаёт `secrets/master.key` (32 случайных байта, `umask 077`, существующий не
    трогает).
  - [ ] `rate-limit` (`systemTable`): ключ хранится хешем, окно по `Clock`; атомарный upsert, 50 параллельных
    попыток → ровно `limit` пропущено; правила изолированы друг от друга; БД недоступна → `UNAVAILABLE`, не
    «пропустить»; первая боевая миграция (`platform/*/schema.ts` добавлен в glob `drizzle.config.ts`),
    `make db-generate` и `production-schema.int.test.ts` зелёные.
- Проверка: make check; make test-int
- Риск: high — секреты и логи без ПД (NFR-16, OBS-04)
- Зависимости: T-004, T-057

### T-059 · Платформа сервера, часть 2: HTTP, процедуры и три процесса
- Статус: done · 48a3be3..351619d
- Модули: `platform/http`, `apps/server/src/entrypoints`, `apps/server/src/main` (`compose.ts`, `router.ts`),
  `tooling/architecture/rules.ts` (+ фикстура: `@orpc/openapi` — к правилу `orpc-server-only-in-api`),
  `packages/contract` (комментарий в `errors.ts`)
- SPEC: NFR-24, SEC-01, SEC-03, OBS-01, OBS-02
- Критерии приёмки:
  - [ ] `createApp({ listener })` на каждый слушатель: `localOnly` читает замкнутое значение, а не запрос;
    `X-Forwarded-*` и `Host` на него не влияют (тест); на `lan` `localOnly`-процедуры отвечают `NOT_FOUND`; порты
    в тестах — `0`, 8140/8141 не занимаются; `lan` открывается и закрывается по настройке без перезапуска, не
    позднее 5 с (int); занятый порт → понятное сообщение.
  - [ ] `Host`: `local` — `localhost`, `127.0.0.1`, `[::1]`; `lan` — те же и IP-адреса, имена отвергаются
    (DNS-rebinding). Изменяющий запрос: `Sec-Fetch-Site` ∈ {`cross-site`, `same-site`} → 403; `Origin` обязан
    совпасть с `Host` или `TRUSTED_ORIGINS`; оба заголовка пусты — допускается (не браузер). Без CORS и
    `trustProxy`; `x-request-id` клиента принимается только по шаблону `[A-Za-z0-9-]{8,64}`, иначе выдаётся новый,
    возвращается в ответе.
  - [ ] Заголовки проверяются точными строками: CSP `default-src 'self'; script-src 'self'; style-src 'self'
    'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none';
    base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, `nosniff`, `Referrer-Policy: no-referrer`,
    `Permissions-Policy` (camera/microphone — self); HSTS и `upgrade-insecure-requests` нет.
  - [ ] oRPC: `OpenAPIHandler` под `/api`; interceptor переводит `BAD_REQUEST` схемы входа в `VALIDATION`, ошибки
    схемы выхода и неизвестные — в `INTERNAL`; в теле нет `message` исключения, стека и issues со значениями;
    `publicProc` / `authed` / `localOnly` / `admin`; пустой реестр сессий → `UNAUTHORIZED`; `/healthz`, `/readyz`
    (БД, после миграций; без деталей); статика `apps/web/dist` с SPA-fallback (не для `/api`; тест обхода пути);
    `@orpc/*` — ровно 1.16.1, как `@orpc/contract`; комментарий в `packages/contract` (`errors.ts`) приведён в
    соответствие: «только с этого компьютера» на `lan` — `NOT_FOUND`.
  - [ ] Минимальный реальный `main/compose.ts` (`compose(config, role)`: пул, миграции, платформа, реестр сессий,
    `system.health`; модули добавит T-007) и `entrypoints/{api,worker,bot}`; `worker` и `bot` пока только живут
    (старт, миграции, лог, остановка); `SIGTERM`: int с дочерним процессом (медленный маршрут в `__fixtures__`) —
    запрос в полёте доведён, новые отвергаются, соединений процесса в `pg_stat_activity` нет, код 0, последняя
    строка лога `process.stopped` на диске; зависание дольше 10 с → код 1.
- Проверка: make check; pnpm vitest run apps/server; вручную: curl -i http://127.0.0.1:8140/healthz
- Риск: high — CSRF и «только localhost» для первого запуска и почтового ящика (R40)
- Зависимости: T-005

### T-060 · Роль приложения без суперпользователя
- Статус: done · a7390e4..fcef673
- Модули: `platform/db` (новый `roles.ts`: `ensureAppRole`, `assertAppRole`; `audit.ts`; `migrate-cli.ts`),
  `platform/config`, `apps/server/src/main/compose.ts`, `Makefile` (`init`) и скрипт правки `.env` в `tooling/`,
  `.env.example`, `@kosht/testing`, `docs/adr/0020-db-roles.md`, `docs/ARCHITECTURE.md` §6,
  `apps/server/src/platform/CLAUDE.md`; `compose.yaml` без изменений
- SPEC: ROLE-01, SEC-04, PRIV-07, NFR-16
- Критерии приёмки:
  - [ ] Конфигурация: `DATABASE_URL` (по умолчанию `postgres://kosht_app@…`) и `DB_PASSWORD_FILE`
    (`secrets/db_app_password`); `MIGRATION_DATABASE_URL` (`postgres://kosht@…`) и `MIGRATION_DB_PASSWORD_FILE`
    (`secrets/db_password`); хост, порт и база обоих адресов должны совпадать, иначе `ConfigError` без значений;
    `make init` создаёт `secrets/db_app_password` (32 случайных байта в hex, 0600, существующий не меняет); сверка
    `CONFIG_VARIABLES` с `.env.example` остаётся зелёной.
  - [ ] `ensureAppRole(ownerPool, { appRole, passwordFile, schemas })` на пуле владельца, после миграций, под той же
    `pg_advisory_lock`; идемпотентно (`CREATE ROLE`, ловить 42710: роль общая для кластера, а блокировка — на базу);
    на каждом старте `ALTER ROLE … LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` (лечит
    ручную порчу), пароль из файла, `GRANT USAGE ON SCHEMA`, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE <владелец> … GRANT … TO kosht_app`, `USAGE` на sequences, если они есть,
    `REVOKE SELECT ON pg_catalog.pg_stats, pg_stats_ext, pg_stats_ext_exprs FROM PUBLIC`, `CREATE` на `public` у
    `PUBLIC` отозван явно; без `TRUNCATE`, `REFERENCES`, `TRIGGER`; на схему `drizzle` прав нет; без
    `ALTER ROLE … SET`; пароль не попадает в лог Postgres (`SET log_min_error_statement = 'panic'` на сессии либо
    готовый SCRAM-verifier) и в логи приложения; список схем — параметр (T-006 добавит `pgboss`).
  - [ ] `assertAppRole(pool)` в `compose.ts` до приёма запросов: старт отказывает с ошибкой без значений, если у
    роли есть `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolreplication`, `rolbypassrls`, членство в любой роли
    (в том числе `pg_read_server_files`) или `CREATE` на схему `public`.
  - [ ] `compose.ts`: пул владельца с `max: 1` и именем `kosht-<роль>-migrate` закрывается (`end`) до возврата
    `compose`, боевой пул — `kosht_app`; int-тест: после `compose()` в `pg_stat_activity` нет сессий владельца с этим
    именем; `make init` заменяет в существующем `.env` значения `DATABASE_URL` и `DB_PASSWORD_FILE`, равные старым
    умолчаниям, и дописывает `MIGRATION_*` (правит программа, агент `.env` не открывает); `make migrate` идёт под
    владельцем.
  - [ ] Int-тест через сырой `pg.Client` под `kosht_app` (мимо аудитора): код 42501 у `pg_read_binary_file`,
    `COPY … TO PROGRAM`, `COPY … FROM PROGRAM`, `lo_import('/etc/passwd')`, `CREATE TABLE`, `CREATE SCHEMA`,
    `CREATE EXTENSION dblink`, `CREATE ROLE`, `CREATE DATABASE`, `ALTER TABLE settings`, `TRUNCATE settings`,
    `SET ROLE kosht`, `ALTER ROLE kosht_app SUPERUSER`, `select` из `pg_stats`, `pg_stats_ext`, `pg_statistic` и
    `drizzle.__drizzle_migrations`; работают: DML через `ScopedDb` и `SystemDb`; таблица, созданная владельцем после
    выдачи прав, сразу доступна; повтор `ensureAppRole` ничего не ломает и возвращает роли атрибуты после ручной
    порчи; `GRANT … ON ALL TABLES` покрывает таблицу, созданную до `DEFAULT PRIVILEGES`.
  - [ ] Аудитор: обращение к `pg_stats`, `pg_stats_ext`, `pg_stats_ext_exprs`, `pg_statistic`,
    `pg_statistic_ext_data` с любой схемой или без неё — `HIDDEN_SQL` (канарейки в `audit.test.ts`); функции
    остаются; комментарий в `audit.ts` («роль — суперпользователь») и паспорт обновлены.
  - [ ] Тестовая инфраструктура: `TestDbContext` получает `admin` (из `MIGRATION_*`: создание и удаление `test_*`,
    шаблон, DDL) и `app` (`kosht_app`); `createTestDb()` отдаёт `pool` (приложение) и `owner` (DDL, фикстуры);
    существующие int-тесты с DDL переведены на `owner`; шаблон собирается владельцем с `ensureAppRole`, отпечаток
    включает текст выдачи прав; `production-schema` и `schema-check` идут под `owner`.
  - [ ] ADR-0020 «Роли БД» (ADR-0006 не правится); `docs/ARCHITECTURE.md` §6: добавлен замок «права роли БД»; в
    итог — список правок `.claude/rules/database.md` и `security-privacy.md` для пользователя.
- Проверка: make check; make test-int; вручную: `make init && make migrate` на существующем томе без `db-reset`,
  `select rolsuper from pg_roles where rolname = 'kosht_app'` → `f`
- Риск: high — главный замок изоляции данных держится на правах роли
- Зависимости: T-005

### T-006 · Платформа: фоновые задачи и события
- Статус: done · 13c1e57..85cf0ca
- Модули: `platform/{jobs,events,db}`, `apps/server/src/main/compose.ts`, `apps/server/src/entrypoints/run.ts`,
  `tooling/architecture/rules.ts`, `apps/server/drizzle.config.ts`, `Makefile`, `@kosht/testing`, `pnpm-workspace.yaml`,
  `apps/server/package.json`, `apps/server/src/platform/CLAUDE.md`
- SPEC: NFR-21, NFR-22, OBS-01, OBS-07, SEC-04
- Критерии приёмки:
  - [ ] pg-boss 12 (точная версия через `catalog:`; имена опций сверены по `.d.ts` установленной версии) только в
    `platform/jobs`; схему `pgboss` ставит владелец до `ensureAppRole` под `withMigrationLock`, в `APP_SCHEMAS`
    добавлена `pgboss`; шаблон тестов, `make migrate` и `migrate-cli` ставят схему, отпечаток шаблона включает версию
    pg-boss; int-тест под `kosht_app` — `createQueue`, `send`, `work`, `complete`, `schedule`, один проход
    `supervise` без 42501 (если нужны права сверх DML — `ESCALATE`, роль молча не расширять); адаптеры `boss-db`
    (`fromDrizzle` на пул приложения, без своего пула) лежат в `platform/db` и добавлены в `PLATFORM_DB`; исключение
    правила `drizzle-and-pg-only-in-db` — только для схемы и репозитория `jobs`.
  - [ ] `defineJob({ name, payload: Zod, options, handle })`; в нагрузке только id (`isolation.mjs` ловит `userId` и
    `householdId`); конверт `{ scope, requestId, payload }`; порт `ScopeVerifier` и реестр (по образцу
    `SessionRegistry`; пока проверка не зарегистрирована — задача отбрасывается с записью в лог); тест: пользователя нет
    или домохозяйство другое — задача отброшена; заглушек в боевом коде нет (тест регистрирует свою реализацию).
  - [ ] `jobs.enqueue(tx, …)` и `events.publish(tx, …)` в той же транзакции через адаптер на `ScopedDb`: откат — ни
    записи, ни задачи; коммит — оба (int-тест); `defineEvent({ name, payload })` с нагрузкой `{ ids ≤ 1000 }`, тест на
    `publish` без подписчиков и на 1001 id.
  - [ ] `defineSubscription`: очередь `evt.<событие>.<модуль>` с `policy: 'short'`, доставка «хотя бы раз»;
    `singletonKey` через `jobKey(scope, …)`: 300 `publish` с одним ключом до старта `work` → обработчик отработал
    ≤ 5 раз (ожидание — промис, который разрешает обработчик, без `sleep`); ключи двух домохозяйств друг друга не
    подавляют; повтор — только для `retryable` кодов каталога.
  - [ ] Расписания: `schedule` вызывается с `{ tz: <настройка `system.time-zone`>, missed: "once" }` (пояс не зашит,
    смена пояса действует после перезапуска `worker`); свой код — чистый помощник `pendingPeriods(watermark, now,
    step)` и водяной знак, проверяются на `FakeClock` (после «простоя» — ровно один догоняющий запуск); `defineSweep`
    на фикстурной таблице `fx_*`: сквозной запрос через `crossTenant` возвращает только `(id, householdId, userId)` и
    ставит задачу на каждого владельца.
  - [ ] `background_job_run` — `systemTable` без `household_id` и `user_id`: вид, статус, прогресс, водяной знак
    расписаний платформы по ключу расписания, ошибка; миграция; водяной знак пользовательских расписаний живёт в
    таблицах модулей (ADR-0008; расхождение ADR-0008 и ARCHITECTURE §9 записано в паспорт); `InlineJobs` в
    `@kosht/testing` (принимает функцию поиска обработчика, форму сверяет тест на сервере); `api` и `bot`:
    `migrate: false`, `supervise: false`, `schedule: false`, `start()` без `work`; `worker`: `work`, расписания,
    `supervise` с явными интервалами; `stop({ graceful: true, timeout ≤ 8000 })` — остановка по SIGTERM ≤ 10 с.
- Проверка: make check; make test-int
- Риск: high — scope в конверте задач, подписки и права роли
- Зависимости: T-005, T-004, T-059, T-060

### T-061 · Живые сигналы: realtime и `events.stream`
- Статус: done · 72f1db1..a2eb42b
- Модули: `platform/{realtime,db}` (новый `db/listen.ts`), `apps/server/src/main/{compose,router}.ts` (`createRouter({ streams })`),
  `apps/server/src/main/router.contract.test.ts`, `apps/server/src/entrypoints/run.ts`,
  `apps/server/src/entrypoints/__fixtures__/stream-api.ts`, `packages/contract` (комментарий в `events.contract.ts`),
  `apps/server/src/platform/CLAUDE.md`, `docs/ARCHITECTURE.md` §4.3, §10.5 и строка 261
- SPEC: NFR-21, OBS-01
- Критерии приёмки:
  - [ ] `realtime.changed(s: ScopedDb, { entity, ids })` — `select pg_notify('kosht_realtime', …)` через `s.db`: внутри
    транзакции сигнал уходит при коммите, при откате и `ROLLBACK TO SAVEPOINT` — нет; `realtime.progress(scope, …)` —
    через пул; сообщение: `householdId`, вид, `entity`, id, без данных; куски ≤ 7500 байт (`Buffer.byteLength`), тест на
    1000 id с `entity` из 48 символов: все куски в пределе, все id дошли.
  - [ ] `LISTEN` на `pg.Client` (`kosht-api-listen`, один на процесс, `keepAlive`) только в `api`; первое подключение при
    старте — неудача есть ошибка старта; потом переподключение с паузой (0,2 с, ×2, потолок 5 с; backoff проверяется
    модульно с подменой таймера); все потоки, включая открытые во время разрыва, закрываются при успешном
    переподключении; входящее сообщение проверяется схемой Zod, неверное — `realtime.bad-message` в лог без текста.
  - [ ] `events.stream` заменяет `authed`-заглушку (`createRouter({ streams })`, хаб собирает `compose`; `platform/http`
    не меняется): хаб хранит карту `householdId → потоки`, ключ берётся из `context.s.scope`, а не из сообщения и не
    из входа; очередь соединения ≤ 1000 со схлопыванием по `(type, entity, id)` (чистый класс с `x.test.ts`),
    переполнение закрывает поток; ≤ 8 потоков на пользователя (девятый закрывает самый старый); закрытие по abort,
    `shutdownSignal` и `stop()`; закрытие потока — `event: done` (клиент выходит из `for await` без ошибки), контракт не
    меняется; порядок остановки: потоки, затем `LISTEN` без переподключения (`realtime.stopped` до `db.closed`), затем
    `jobs.stop`, затем пул.
  - [ ] Int: реальный порт 0, чтение SSE через `fetch` с помощником-парсером (`event: message`, `data:` JSON,
    комментарии keepalive, `event: done`); A не получает сигналы B — барьер: сначала `changed` для B, затем «часовой»
    `changed` для A, получение часового доказывает, что сигнал B уже был бы доставлен; 300 `changed` по разным id
    доходят; `pg_terminate_backend` под владельцем закрывает потоки, новый поток получает сигналы; откат — сигнала нет,
    коммит — есть; `SIGTERM` при открытом SSE на настоящем `run.ts` (`RunOptions.setup(composition)` и фикстура
    `stream-api.ts`) ≤ 10 с, код 0; в `pg_stat_activity` нет `kosht-api-listen`; у `worker` и `bot` по-прежнему
    только `kosht-<роль>`; существующие проверки `processes.int.test.ts` (последние строки лога `db.closed`,
    `process.stopped`) не ломаются.
  - [ ] Комментарий `events.contract.ts:28` («T-006») исправлен на T-061; паспорт `platform` («Не видит … pg_notify») и
    ARCHITECTURE приведены к факту; правка `.claude/rules/backend-module.md` («в realtime передавай `s.scope`» →
    `changed(s, …)` с `ScopedDb`) — предложением пользователю в итоге.
- Проверка: make check; make test-int
- Риск: high — сигналы между домохозяйствами
- Зависимости: T-059, T-060

### T-007 · Все 36 модулей пустыми, но живыми: паспорта, корень композиции и реестры
- Статус: todo
- Модули: все 36 модулей `docs/CAPABILITIES.md`, `apps/server/src/main`, `platform/tools`, `tooling/gen`
- SPEC: NFR-10, AGT-03, PRIV-06
- Критерии приёмки:
  - [ ] Цели `new-module id=…` и `new-table module=… name=…` (заготовка схемы `userOwnedTable` + строка
    `defineUserData` + подсказка фикстуры изоляции); ими созданы 36 папок `apps/server/src/modules/<id>/`:
    `CLAUDE.md` по `docs/templates/module-passport.md` (≤ 60 строк: назначение, требования, ярус, зависимости,
    запреты), `index.ts`, `module.ts` с `defineModule({ id })`.
  - [ ] `defineModule` и помощники `defineJob`, `defineSweep`, `defineSubscription`, `defineTool` (`read | write |
    destructive`, наборы `core | legal | planning | reports`), `defineUserData`, `defineSetting`; реестры (роутеры,
    задачи, подписки, расписания, инструменты, каналы доставки, обработчики отмены и подтверждения, владельцы данных,
    настройки) работают на пустых списках; повторное имя → ошибка при старте.
  - [ ] `main/compose.ts` создаёт модули в порядке топологической сортировки `modules.ts` — тест сверяет порядок;
    граф dependency-cruiser содержит все 36 модулей, `MIN_MODULES` поднят до их охвата.
  - [ ] Паспорт `transactions` фиксирует фасад с агрегатами пачками (`aggregate(s, { period, groupBy })`) до первой
    задачи модуля (ARCHITECTURE §15).
- Проверка: make check; make deps-check; pnpm vitest run apps/server/src/main
- Риск: medium — ошибка в реестрах и порядке сборки всплывёт сразу у всех модулей
- Зависимости: T-006, T-061, T-002

### T-008 · Каркас сайта и дизайн-система «Пуща и янтарь»
- Статус: todo
- Модули: `apps/web`, `apps/web/src/app`, `apps/web/src/ui`, `apps/web/src/lib`, `e2e`
- SPEC: DES-00, DES-01, DES-02, DES-05, DES-06, DES-07, DES-08, DES-09, DES-15, DES-16, DES-17, NFR-19, NFR-20, P9
- Экран: каркас — design/screens/Main.dc.html и design/screens/MobileHome.dc.html (боковое меню, верхняя панель,
  нижняя панель телефона); компоненты — `design/kit.css`, `design/DESIGN.md`
- Критерии приёмки:
  - [ ] Vite + React 19, TanStack Router (группы `_public`, `_local`, `_app`, `_app/admin` с проверкой роли
    в `beforeLoad`), TanStack Query + типизированный клиент oRPC из `@kosht/contract`, Mantine 9; тема из
    `ui/theme/tokens.css` (копия `design/tokens.css` + `--warn-bar`), `category-colors.ts`, `chart-colors.ts`; Onest
    и Literata через `@fontsource-variable` — e2e: ни одного запроса шрифтов и стилей на внешние адреса.
  - [ ] Компоненты `ui/components` (Money, WhyButton, Formula, LawRefChip, LawQuote, StatusBadge, CategoryIcon,
    LimitBar, StatCard, EmptyState, Skeletons, Sheet, ConfirmDialog, UndoToast, PageHeader, Steps) с компонентными
    тестами состояний и ролей; `StatusBadge` без иконки не компилируется; `LimitBar` при 79 / 80 / 99 / 100 % —
    `--brand` / `--warn-bar` + треугольник / `--danger` + «!»; `Money` — формат DES-17, `tabular-nums` в таблицах.
  - [ ] Каркас: меню по DES-15 строится из реестра маршрутов — пункты ещё не готовых фич скрыты; колокольчик,
    «Сканировать чек» и плавающая кнопка ассистента скрыты до задач своих модулей; нижняя панель телефона; граница
    ошибок; i18n; клиент `events.stream` → `invalidateQueries`; `queryClient.clear()` при выходе.
  - [ ] `/dev/gallery` (только в разработке) — все компоненты во всех состояниях; цели `e2e` (Playwright +
    `@axe-core/playwright`) и `new-feature id=…`; Vitest-проект `web` (Testing Library + MSW).
  - [ ] `make e2e`: axe — 0 нарушений (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) на `/dev/gallery` при 1440
    и 390 px, нет горизонтальной прокрутки; скриншоты галереи сверены с `kit.css` (отличия — в итоге задачи);
    `no-raw-colors` и проверка литералов зелёные на `apps/web`.
  - [ ] Прокси Vite `/api` → `127.0.0.1:8140` настроен без `changeOrigin` (иначе `Host` станет `:8140`, а проверка
    CSRF и `Host` из T-059 даст 403); `TRUSTED_ORIGINS` в `make dev` по умолчанию пуст.
  - [ ] Клиент `events.stream`: конец потока (`event: done`) или ошибка → переподключение и `invalidateQueries()` всех
    запросов.
- Проверка: make check; make e2e; вручную: скриншоты 1440/390 рядом с `design/screenshots/desktop/Main.png`
- Риск: medium — от дизайн-системы зависят все экраны; ошибка доступности размножится
- Зависимости: T-007, T-003, T-057, T-061

### T-009 · Сквозной срез: первый запуск, вход и счёт «Наличные» с тестом изоляции по реестру
- Статус: todo
- Модули: `identity`, `accounts`, `features/setup`, `features/auth`, `features/accounts`, `entities/account`,
  `@kosht/testing`, `e2e`
- SPEC: AUTH-10, AUTH-08, ROLE-01, ROLE-02, ADM-01, SEC-01, SEC-04, STMT-01, NFR-24
- Экран: Setup — design/screens/Setup.dc.html (только создание администратора); Login — design/screens/Login.dc.html
  (форма входа без «Забыли пароль?» и демо-входа); Accounts — design/screens/Accounts.dc.html (только список)
- Критерии приёмки:
  - [ ] Better Auth — только ядро; его таблицы — `systemTable` модуля `identity`, поля `role`, `status`, `demo`,
    `household_id`; `householdId` в сессии; argon2id из `node:crypto` (m = 64 МиБ, t = 3, p = 1); cookie
    `kosht_session` (`HttpOnly`, `SameSite=Lax`), `cookieCache` выключен; выход завершает сессию.
  - [ ] Признак `system_state.initialized`: экран первого запуска доступен только на локальном слушателе и только пока
    система не инициализирована (повторно и через `lan` — нет); создание администратора заводит домохозяйство
    и публикует `identity.system-initialized` и `identity.user-registered`.
  - [ ] `accounts` по `identity.user-registered` создаёт «Наличные» идемпотентно (двойная доставка — один счёт);
    `contract.accounts.list` (`authed`) → роутер → сценарий → `ScopedDb` + аудитор → страница сайта через TanStack Query.
  - [ ] Генератор тестов изоляции в `@kosht/testing` по реестрам процедур и инструментов: пользователь A с id из B →
    `NOT_FOUND` или пусто; тест полноты `defineUserData` (каждая `userOwnedTable` в реестре); новая процедура без
    фикстуры → подсказка «добавьте фикстуру»; контрактный тест: `accounts.list` без сессии → `UNAUTHORIZED`.
  - [ ] e2e на чистой БД: `127.0.0.1:8140` → экран первого запуска → администратор создан → вход →
    «Наличные · 0,00 BYN»; axe 0 на этих маршрутах при 1440 и 390.
  - [ ] Ограничение размера тела запроса `/api` (`bodyLimit` Hono; значение — настройка, по умолчанию достаточное для
    JSON, файлы идут отдельным путём T-016); превышение → `VALIDATION`; тест. (Находка ревью T-059.)
  - [ ] `identity` регистрирует `ScopeVerifier` (порт из T-006): пользователь существует и домохозяйство то же;
    тест: задача фоновой очереди с чужим `householdId` отбрасывается.
- Проверка: make check; make e2e; pnpm vitest run apps/server/src/main
- Риск: high — вход, сессия и первый тест изоляции; на них опираются все следующие задачи
- Зависимости: T-008, T-004, T-005, T-007, T-059

### T-010 · ИИ-шлюз и чат-заглушка: поток ответа агента через oRPC
- Статус: todo
- Модули: `llm`, `agent`, `chat`, `accounts`, `platform/telemetry`, `platform/tools`, `features/assistant`,
  `@kosht/testing`, `e2e`
- SPEC: LLM-01, LLM-06, LLM-09, NFR-04, NFR-11, NFR-21, AGT-01, CHAT-02, OBS-03, QA-17
- Экран: Assistant — design/screens/Assistant.dc.html (только лента: поток текста, подпись шага, одна карточка)
- Критерии приёмки:
  - [ ] `LlmGateway` (`model`, `extract`, `classify`, `embed`, `transcribe`) по ARCHITECTURE §8.1; реестр моделей
    (таблица) и цепочки по задаче из возможностей — unit-тесты выбора; инвариант: при `cloudAllowed = false` в цепочке
    только локальные записи; `systemCaller("<модуль>")` для задач без данных пользователя.
  - [ ] Тестовый провайдер — настоящий адаптер `ProviderAdapter` в реестре (не заглушка в коде сценариев); режимы
    `replay | record | live`; в тестах `replay`: промах кассеты → ошибка с подсказкой `make ai-record SCENARIO=…`;
    цель `ai-record`; `ReplayModel` и `MockLanguageModelV4` в `@kosht/testing`.
  - [ ] Журнал расхода: строка на каждый вызов (задача, провайдер, модель, токены, длительность, стоимость, ошибка)
    без текстов (тест); Langfuse через `@langfuse/vercel-ai-sdk` + `@langfuse/otel` с закреплёнными версиями OTel,
    при выключенном Langfuse всё работает; вызов внутри `s.transaction` → `LLM_IN_TRANSACTION`; интерфейсы
    маскирования (`Masker`, порт `KnownNames`) объявлены, реализация — T-024.
  - [ ] `agent`: `ToolLoopAgent` ≤ 8 шагов, на последнем `toolChoice: "none"`; адаптер `defineTool` → AI SDK строит
    `ctx.s` из scope запуска; инструмент `list_accounts` (`read`, `core`) модуля `accounts` проверен тестом без
    модели; ошибка инструмента → `{ ok: false, code }`; префикс (подсказка + `core`) ≤ 3 000 токенов (`o200k_base`, тест).
  - [ ] `chat`: диалоги и сообщения (`UIMessage.parts`, `userOwnedTable`); `chat.send` — итератор событий oRPC →
    `useChat` рисует поток, подпись шага из словаря `tools` и карточку; запуск не привязан к соединению: вкладку
    закрыли — ответ дописан в БД и виден при повторном открытии (int-тест + e2e); `chat.stop(runId)` проверяет
    владельца и освобождает модель; поток идёт через прокси Vite. Интеграция oRPC ↔ AI SDK 7 не выходит —
    `ESCALATE` с проектом ADR на маршрут Hono `/api/chat` (ADR-0005).
  - [ ] e2e на кассетах: первое событие потока ≤ 1 с после отправки; axe 0 на `/assistant` при 1440 и 390.
- Проверка: make check; make e2e; pnpm vitest run apps/server/src/modules/llm apps/server/src/modules/agent apps/server/src/modules/chat
- Риск: medium — спайк потока чата с записанным запасным путём (ARCHITECTURE §15); данные наружу пока не уходят
- Зависимости: T-009, T-006

### T-011 · Запуск одной командой и закрытие бетона: Docker Compose, образ, команды разработчика
- Статус: todo
- Модули: `compose.yaml`, `docker/`, `Makefile`, `apps/web/CLAUDE.md`, `apps/server/CLAUDE.md`,
  `tooling/coverage-baseline.json`
- SPEC: NFR-01, NFR-02, NFR-14, NFR-18, OBS-05, OBS-06, QA-01
- Критерии приёмки:
  - [ ] Профили: без профиля — `db`; `app` — `api`, `worker`, `bot` из одного образа; `models` — llama-server
    и whisper.cpp (точные версии, `/dev/dri` + `group_add: ${RENDER_GID:-992}`; модели здесь не скачиваются —
    загрузчик в T-024); `observability` — Langfuse v4 (свой Postgres, ClickHouse с лимитом памяти, Valkey, SeaweedFS),
    включён по умолчанию, `127.0.0.1:3001`, регистрация закрыта, телеметрия выключена. Порты только с адресом,
    образы — с точными тегами, секреты — Compose `secrets:` (два: `db_password` и `db_app_password`; в сервисе `app`
    `DB_PASSWORD_FILE=/run/secrets/db_app_password`, `MIGRATION_DB_PASSWORD_FILE=/run/secrets/db_password`).
  - [ ] Dockerfile: tsdown → один `.mjs` на точку входа, `node:26-trixie-slim`, `USER node`, `read_only`,
    `cap_drop: ALL`, `init: true`.
  - [ ] Цели: `dev` (инфраструктура в контейнерах, код на хосте, Vite `127.0.0.1:5173` с прокси `/api`), `up`, `down`
    (`--profile '*'`), `restart`, `ps`, `build`, `db-reset` и `restore file=…` (через ввод `yes`), `backup`
    (`pg_dump -Fc` + файлы, без мастер-ключа), `doctor` (Node, pnpm, Docker Engine — не Desktop, версия ≥ 28.3.3,
    группы `docker`/`render`, свободны 8140–8143, 5440, 3001), `audit`, `check-full` (`check` + `e2e` + `audit` +
    бюджет бандла); `init` записывает `RENDER_GID`.
  - [ ] На чистой машине `make init && make up` → `/readyz` 200 → первый запуск и вход из T-009 работают
    в контейнерах; трасса ответа чата-заглушки видна в Langfuse.
  - [ ] Паспорта `apps/web/CLAUDE.md`, `apps/server/CLAUDE.md` и пакетов актуальны; база покрытия записана
    в `tooling/coverage-baseline.json`, падение больше 0,5 п. п. делает `make check` красным (тест).
  - [ ] Замеры на этой машине — в итоге задачи: `make check` (бюджет 120 с), `make check-quick` (45 с),
    `make deps-check` (10 с), `pre-commit` (3 с) и `commit-msg` (1 с); сверх бюджета — `ESCALATE`, а не правка чисел.
  - [ ] Точки входа `api`/`worker`/`bot`: обработчики `uncaughtException` и `unhandledRejection` пишут строку
    `process.crashed` со стеком, сбрасывают лог и выходят с кодом 1; `SIGTERM`/`SIGINT` во время миграций тоже
    пишут `process.stopped` и выходят чисто; `MIGRATIONS_DIR` в `platform/db/migrate.ts` не зависит от
    `import.meta.url` (сборка в один `.mjs` через tsdown); образ везёт `node_modules` рядом с бандлом (пакет
    `libpg-query` с `.wasm` остаётся внешним, ADR-0019). (Находки ревью T-059 и T-058.)
- Проверка: make check; make check-full; make doctor; вручную: make init && make up, экран первого запуска на
  127.0.0.1:8140, трасса в Langfuse на 127.0.0.1:3001
- Риск: medium — сбой запуска на чистой машине ломает показ, но откатывается `git revert`
- Зависимости: T-010

## Фаза 2 · Операции

Контрольная точка: регистрация с согласиями → письмо в локальном ящике → вход; сброс пароля и код восстановления;
колокольчик уведомлений; «Мои данные»: архив и удаление аккаунта; админка «Пользователи» и «Система»; анкета
и «Что ассистент знает обо мне»; «Счета»; «Операции»: ручной ввод с «Отменить», фильтры и страницы по 50,
массовые действия с подтверждением, категоризация правилами и обучение на исправлении; `make bench`: страница
операций ≤ 150 мс p95.

### T-012 · Регистрация с согласиями, подтверждение почты и локальный почтовый ящик
- Статус: todo
- Модули: `identity`, `privacy`, `mail`, `features/auth`, `features/mailbox`, `features/settings`
- SPEC: AUTH-01, AUTH-02, AUTH-03, AUTH-06, PRIV-01, PRIV-02, SEC-01, NFR-24
- Экран: Register — design/screens/Register.dc.html; Mailbox — design/screens/Mailbox.dc.html; Settings —
  design/screens/Settings.dc.html, вкладка «Профиль и вход» (отметка о неподтверждённой почте); политика ПД — `/policy`
- Критерии приёмки:
  - [ ] Регистрация по email и паролю (≥ 12 символов, индикатор надёжности); обязательное согласие на обработку ПД
    с пересказом целей, данных, сроков и прав; отдельная необязательная галочка облачного согласия с предупреждением
    о передаче за рубеж (PRIV-02); согласия хранятся с версией текста и временем, событие `privacy.consent-changed`;
    без согласия на ПД регистрация не проходит (тест).
  - [ ] Публичная страница «Политика обработки персональных данных» (`/policy`).
  - [ ] `mail`: порт `MailTransport` — SMTP (Nodemailer) и локальный ящик (таблица); пока SMTP не настроен, все письма
    в ящике; страница ящика — только на локальном слушателе, без входа, с пометкой «только для демо и разработки»;
    через `lan` недоступна; при настроенном SMTP ящик выключен (тесты на оба режима).
  - [ ] После регистрации — письмо подтверждения в ящике, ссылка подтверждает адрес; до подтверждения системой можно
    пользоваться, в настройках — отметка и «Отправить письмо ещё раз»; новый пользователь получает своё
    домохозяйство и «Наличные».
  - [ ] Тексты писем — из словарей `i18n`; ссылки в письмах — по `localhost`, при включённом сетевом доступе — по
    сетевому адресу (NFR-24).
  - [ ] e2e: регистрация → письмо в ящике → подтверждение по ссылке → вход; axe 0 на `/register`, `/mailbox`,
    `/policy`, `/settings` при 1440 и 390.
- Проверка: make check; make e2e; pnpm vitest run apps/server/src/modules/identity apps/server/src/modules/privacy apps/server/src/modules/mail
- Риск: high — согласия на обработку ПД и облако — юридически значимые записи (99-З)
- Зависимости: T-011, T-009

### T-013 · Вход и восстановление доступа: сброс по ссылке, код восстановления, блокировка, частота попыток
- Статус: todo
- Модули: `identity`, `mail`, `features/auth`, `features/setup`, `features/settings`
- SPEC: AUTH-04, AUTH-05, AUTH-08, AUTH-10, AUTH-11, AUTH-12, SEC-01, SEC-02
- Экран: Login — design/screens/Login.dc.html (состояния blocked, forgot-password, wrong-password; кнопка демо-входа
  скрыта до T-054); Setup — design/screens/Setup.dc.html, шаг «код восстановления»; Settings — «Профиль и вход»
  (смена пароля, код восстановления)
- Критерии приёмки:
  - [ ] «Забыли пароль?» → письмо со ссылкой; ссылка одноразовая, живёт 1 час: повторное использование и истёкшая
    ссылка (`FakeClock`) отклоняются с понятным сообщением (КП AUTH).
  - [ ] Код восстановления показывается один раз при создании администратора и по желанию в настройках; хранится
    хэшем argon2id; «Войти с кодом восстановления» задаёт новый пароль и выдаёт новый код, старый больше не работает;
    сравнение — постоянное по времени.
  - [ ] Смена пароля в настройках; выход; ограничение частоты входа, сброса и кода восстановления по ключу
    email/`user_id` — сверх порога `RATE_LIMITED` с текстом «попробуйте через N минут» (порог — `defineSetting`).
  - [ ] Заблокированный не входит и видит понятное сообщение; блокировка сразу отзывает действующие сессии (int-тест);
    общая проверка «последний администратор» в `identity` для блокировки, смены роли и удаления (тест: последнего
    админа заблокировать, удалить и лишить роли нельзя).
  - [ ] Неверный пароль — состояние wrong-password без раскрытия, существует ли email.
  - [ ] e2e: забыл пароль → письмо в ящике → новый пароль → вход; повторная ссылка — отказ; axe 0 на `/login`,
    `/recovery`, `/setup` при 1440 и 390.
- Проверка: make check; make e2e
- Риск: high — права доступа и восстановление единственного администратора (R36)
- Зависимости: T-012

### T-014 · Отмена, подтверждения и «Откуда эта цифра?»: общие механизмы действий и расчётов
- Статус: todo
- Модули: `actions`, `explain`, `entities/explanation`, `apps/web/src/ui`
- SPEC: P5, EXPL-01, EXPL-02, AGT-03, AGT-05, AGT-07
- Экран: Main — design/screens/Main.dc.html, состояние `Main--why-panel` (панель «Откуда эта цифра?» как общий
  виджет; на главной появится в T-033)
- Критерии приёмки:
  - [ ] `actions`: журнал отменяемых действий с каналом (сайт / Telegram) и временем; реестр обработчиков отмены
    (`undo` в `defineModule`); `actions.record(tx, …)` → `undoToken`; «Отменить» вызывает обработчик модуля-владельца;
    повторная отмена ничего не меняет; чужой токен → `NOT_FOUND`.
  - [ ] Ожидающие решения «Да/Нет»: создаются фасадом модуля-владельца с описанием изменений; реестр обработчиков
    ответов (`confirm`); одна функция `actions.confirm(s, pendingId, answer)` для всех каналов; повторный ответ — без
    эффекта; распознавание короткого «да / нет» текстом — чистая функция для чата и бота (ARCHITECTURE §5).
  - [ ] `explain`: `explain.save(s, calc)` → `traceId`; `explain.get(s, traceId)` возвращает ровно сохранённую трассу —
    тест меняет исходные данные и получает прежний расчёт (EXPL-02); инструмент `explain_number` (`read`, `core`);
    общий реестр ключей трассы и тест: у каждого ключа, который строят расчёты `calc`, есть подпись в `formulas`.
  - [ ] Сайт: `WhyButton` → панель (Sheet на компьютере, нижняя шторка на телефоне) с формулой из подписей словаря
    `formulas`, периодом и ссылками на основания; `UndoToast` и `ConfirmDialog` подключены к `actions` через
    `lib/api`; компонентные тесты; панель в `/dev/gallery` на трассе `freeBalance`.
  - [ ] Пользовательские таблицы `actions` и `explain` — в `defineUserData` и тесте изоляции.
- Проверка: make check; make e2e; pnpm vitest run apps/server/src/modules/actions apps/server/src/modules/explain
- Риск: medium — «Да/Нет» и «Отменить» используют все модули; ошибка — двойное действие или отмена чужого
- Зависимости: T-013, T-008

### T-015 · Уведомления: центр с колокольчиком, виды и настройки по каналам
- Статус: todo
- Модули: `notifications`, `actions`, `features/notifications`, `features/settings`, `entities/notification`
- SPEC: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05
- Экран: Main — design/screens/Main.dc.html, состояние `Main--notifications` (колокольчик со счётчиком и список);
  Settings — design/screens/Settings.dc.html, вкладка «Уведомления» (`Settings--notifications-settings`; столбец
  Telegram неактивен до T-053)
- Критерии приёмки:
  - [ ] Фасад `notifications.notify(s, { kind, key, objectRef, decisionId? })` идемпотентен по ключу; каталог видов
    NOTIF-02 (пользователь) и NOTIF-03 (администратор), тексты — из словаря по виду; уведомление с действием ссылается
    на ожидающее решение `actions`, а не хранит свой вопрос.
  - [ ] Реестр каналов доставки (`web` сейчас, `telegram` подставит T-053); вид, отключённый в канале, туда не
    доставляется (тест на матрицу вид × канал).
  - [ ] Лента с курсором, счётчик непрочитанных, «прочитано», переход к объекту; кнопки «Да / Нет», «Показать»,
    «Отменить» в уведомлении вызывают `actions`; сигнал `realtime.changed` обновляет колокольчик без перезагрузки.
  - [ ] Уведомления администратора видят только администраторы (тест ролей).
  - [ ] Колокольчик в каркасе показан; axe 0 на главной с открытым списком и на `/settings` (вкладка «Уведомления»)
    при 1440 и 390.
- Проверка: make check; make e2e
- Риск: medium — дубли или чужое уведомление сразу заметны пользователю
- Зависимости: T-014, T-006

### T-016 · Файлы и «Мои данные»: приём файлов, выгрузка архива и удаление аккаунта
- Статус: todo
- Модули: `files`, `privacy`, `identity`, `llm`, `features/settings`
- SPEC: SEC-03, PRIV-02, PRIV-05, PRIV-06, PRIV-07, AUTH-12, OBS-05, RCPT-11, STMT-10
- Экран: Settings — design/screens/Settings.dc.html, вкладки «Конфиденциальность» (`Settings--privacy`: облачное
  согласие дать и отозвать) и «Мои данные» (`Settings--my-data`)
- Критерии приёмки:
  - [ ] `files`: тип по содержимому (`file-type`) + белый список; лимиты (фото 15 МБ, выписка 25 МБ, до 10 файлов за
    раз — `defineSetting`); подменённое расширение отклоняется; путь строит сервер, имя файла — только метаданные;
    выдача только владельцу через `s` (чужой `fileId` → `NOT_FOUND`); удаление.
  - [ ] Облачное согласие даётся и отзывается в настройках; отзыв действует на следующий же вызов модели (тест через
    цепочку `llm`: после отзыва — только локальные записи).
  - [ ] «Скачать все мои данные»: задача `worker` собирает потоковый ZIP по реестру `defineUserData` (машиночитаемые
    данные + исходные файлы), уведомление о готовности, файл выдаётся только владельцу.
  - [ ] «Удалить аккаунт»: подтверждение паролем → удаление через реестр владельцев данных (дети раньше родителей),
    каталог файлов домохозяйства, трассы Langfuse пользователя (владелец — `llm`, через реестр), ожидающие задачи,
    последней — запись `identity`; КП PRIV: после удаления 0 строк пользователя во всех `userOwnedTable` и пустой
    каталог файлов, данные другого домохозяйства не изменены; последний администратор себя удалить не может (AUTH-12).
  - [ ] Тест полноты: у каждой `userOwnedTable` есть строка экспорта и удаления.
  - [ ] axe 0 на `/settings` (вкладки «Конфиденциальность» и «Мои данные») при 1440 и 390.
- Проверка: make check; make e2e; pnpm vitest run apps/server/src/modules/files apps/server/src/modules/privacy
- Риск: high — необратимое удаление данных и выдача файлов только владельцу
- Зависимости: T-015, T-010

### T-017 · Администрирование: раздел, пользователи и система
- Статус: todo
- Модули: `admin`, `identity`, `system`, `mail`, `features/admin`
- SPEC: ADM-01, ADM-30, ADM-60, AUTH-05, AUTH-12, ROLE-02, PRIV-07, NFR-16, NFR-23, NFR-24, OBS-07
- Экран: Admin — design/screens/Admin.dc.html, вкладки «Пользователи» (`Admin--users`) и «Система» (`Admin--system`);
  остальные вкладки скрыты до задач своих модулей
- Критерии приёмки:
  - [ ] `/admin/*` — только роль администратора (обычный пользователь — отказ на сервере и редирект на сайте); `admin`
    берёт данные только из admin-фасадов (импорт пользовательских схем ловит `make deps-check`); в ответах админки
    нет финансовых данных, фактов и переписки (контрактный тест на форму DTO).
  - [ ] «Пользователи»: email, дата регистрации, подтверждён ли email, статус, роль, Telegram (пока «нет»), режим
    облачный / локальный; заблокировать и разблокировать, удалить с подтверждением (`actions`), назначить и снять
    администратора; последний администратор защищён.
  - [ ] «Сбросить пароль»: ссылка уходит самому пользователю (почта; Telegram добавит T-053); администратору
    показывается, только если у пользователя нет ни почты, ни Telegram — с предупреждением, записью в журнал
    и уведомлением пользователю при следующем входе «Пароль был сброшен администратором <дата>» (R37).
  - [ ] «Система»: фоновые задачи из `background_job_run` (выполняется, запланировано, последние ошибки); SMTP — поля
    только для записи («задан ✓ / не задан») и «Отправить тестовое письмо»; часовой пояс (меняет «сегодня», тест на
    `FakeClock`); «Доступ с других устройств» открывает и закрывает слушатель `lan` без перезапуска; статус Langfuse
    и ссылка. Токен бота и «Пересоздать демо-данные» скрыты до T-052 и T-054.
  - [ ] axe 0 на `/admin/users` и `/admin/system` при 1440 и 390.
- Проверка: make check; make e2e
- Риск: high — права администратора и запрет доступа к чужим данным (PRIV-07, R37)
- Зависимости: T-016, T-013, T-015

### T-018 · Профиль и память ассистента: анкета на 1 минуту и «Что ассистент знает обо мне»
- Статус: todo
- Модули: `profile`, `features/onboarding`, `features/memory`
- SPEC: PROF-01, PROF-02, PROF-03, PROF-04, PROF-05, PROF-06, AUTH-07, AGT-03
- Экран: Onboarding — design/screens/Onboarding.dc.html (`Onboarding--question-2`); Memory — design/screens/Memory.dc.html
- Критерии приёмки:
  - [ ] Факт: значение, источник (анкета / чат со ссылкой на сообщение / по выпискам / вывод системы), дата, статус
    «подтверждён / предположение»; параметры PROF-01; событие `profile.facts-changed` пачкой.
  - [ ] Анкета (6 вопросов PROF-02) показывается один раз после первого входа, каждый вопрос пропускается, итог
    «Вот что я запомнил».
  - [ ] «Что ассистент знает обо мне»: факты по темам с источником, датой и статусом; подтвердить, исправить, удалить
    с «Отменить», добавить; удалённый факт фасад больше не возвращает (КП PROF).
  - [ ] Факты с датой считаются на дату вопроса: ребёнок, которому исполнилось 18, в «детях для вычета» не
    учитывается (domain-тест, PROF-06).
  - [ ] Фасад: `getFacts(s, keys, onDate)`, `upsertDerivedFact(s, …)` (статус «предположение», PROF-03),
    `recordAnswer(s, …)` (PROF-04); реализация `KnownNames` для маскирования `llm` подставлена через реестр;
    инструменты `read_profile_facts` (`read`) и `upsert_profile_fact` (`write` + отмена).
  - [ ] axe 0 на `/onboarding` и `/memory` при 1440 и 390.
- Проверка: make check; make e2e
- Риск: medium — профиль влияет на налоговые ответы, но сам сумм не считает
- Зависимости: T-017, T-012

### T-019 · Счета и курсы НБРБ: экран «Счета», остатки с датой, валюты с трассой
- Статус: todo
- Модули: `fx-rates`, `accounts`, `features/accounts`, `entities/account`
- SPEC: STMT-01, STMT-02, STMT-09, EXPL-01, AGT-03, AGT-07
- Экран: Accounts — design/screens/Accounts.dc.html (+ `Accounts--add-account`)
- Критерии приёмки:
  - [ ] `FxRatesSource` НБРБ: запрос по ISO-коду, учёт `Cur_Scale`, выходной → последний установленный курс, кэш
    в БД (`publicTable`); тесты на фикстурах без сети; пересчёт в BYN — `calc` с курсом в трассе.
  - [ ] Счёт: тип, банк, валюта, маска (4 цифры), название, начальный остаток, остаток и дата остатка (показывается
    всегда); служебный «Карта, не указана»; создать, переименовать, задать начальный остаток (с «Отменить»), удалить —
    только через подтверждение; событие `accounts.balances-changed`.
  - [ ] Фасад для `transactions` и `statements`: найти или создать счёт по банку + маске + валюте, применить
    изменение остатка, получить «Наличные» и «Карта, не указана».
  - [ ] Экран: итоги и валютные остатки с `WhyButton` (курс НБРБ на дату в трассе); 4 состояния DES-16.
  - [ ] Инструменты `list_accounts`, `create_account` и `rename_account` (`write`), `delete_account` (`destructive`).
  - [ ] axe 0 на `/accounts` (и с открытой формой) при 1440 и 390.
- Проверка: make check; make e2e
- Риск: medium — остатки и курсы видит пользователь; расчёты — под тестами `calc`
- Зависимости: T-018, T-014

### T-020 · Контрагенты и категории: очистка названий, справочник и гибридная категоризация
- Статус: todo
- Модули: `merchants`, `categories`, `entities/category`
- SPEC: STMT-06, CAT-01, CAT-02, CAT-03, CAT-04, CAT-06, CAT-07, RCPT-15, LLM-05
- Экран: выбор категории с «Новая категория» (по design/screens/Operations.dc.html) — компонент в `entities/category`
  и `/dev/gallery`; в «Операции» его встраивает T-021
- Критерии приёмки:
  - [ ] Очистка названий: «OOO EVROTORG T-0042 MINSK UL…» → «Евроопт» (тест); убираются номера терминалов, адреса,
    MCC, служебные префиксы; исходное описание сохраняется; справочник контрагентов РБ и алиасы — `publicTable`;
    нормализация наименований позиций без веса и жирности (RCPT-15); функция похожести названий (`fuzzball` +
    `pg_trgm`), порог — `defineSetting`.
  - [ ] 26 расходных и 7 доходных встроенных категорий (`system_categories`, `publicTable`) с иконкой и цветом из
    `category-colors.ts`; свои — `userOwnedTable`: добавить, переименовать, скрыть; встроенная только скрывается
    (строка настроек домохозяйства); ссылка на категорию — две колонки + `CHECK` «ровно одна».
  - [ ] Гибридный порядок: правила пользователя → глобальные правила (справочник, ключевые слова, MCC) → модель
    (`llm.classify` строго из существующих категорий, схема Zod); источник категории сохраняется для «Откуда эта
    цифра?»; платёж по кредиту → «Кредиты и займы».
  - [ ] Пакетная категоризация: из 100 операций, 90 покрытых правилами, модель вызывается один раз на 10 (тест со
    шпионом шлюза); кэш одинаковых классификаций контрагента (LLM-05).
  - [ ] Позиции чека категоризируются тем же порядком по наименованию («Молоко 3,2%» → Продукты) — тест.
- Проверка: make check; pnpm vitest run apps/server/src/modules/merchants apps/server/src/modules/categories
- Риск: medium — неверная категория заметна и правится пользователем
- Зависимости: T-019, T-010

### T-021 · Операции: таблица со страницами, фильтры, ручной ввод, карточка и правка с отменой
- Статус: todo
- Модули: `transactions`, `accounts`, `features/operations`, `entities/transaction`, `entities/category`
- SPEC: TXN-01, TXN-02, TXN-03, TXN-05, FIN-01, STMT-02, STMT-09, CAT-02, AGT-03, AGT-05, AGT-07, P5
- Экран: Operations — design/screens/Operations.dc.html (состояния loading, empty, error, add-operation,
  operation-panel); скрыты до своих задач: признак и фильтр «есть чек» — T-028, признак «регулярный» — T-030,
  импорт в карточке — T-026, «Выгрузить в Excel» — T-051
- Критерии приёмки:
  - [ ] Операция: счёт, тип (доход / расход / перевод / возврат), дата и время, сумма и валюта, сумма в BYN и курс
    НБРБ (трасса), исходное описание, контрагент, категория и её источник, источник операции, видимость (`personal`
    по умолчанию), ссылки на пару перевода и исходную покупку возврата.
  - [ ] `transactions.list`: страница + размер (≤ 100, по умолчанию 50) + `total`, устойчивая сортировка (последний
    ключ — `id`); поиск по тексту; фильтры по периоду, счёту, категории, типу, сумме, источнику — в адресе; компьютер —
    таблица со страницами, телефон (390 px) — список «Показать ещё» без горизонтальной прокрутки.
  - [ ] Добавление и правка — сразу, с `UndoToast`; выбор категории с «Новая категория»; удаление — `ConfirmDialog` →
    ожидающее решение → «Отменить» после; остаток счёта пересчитывается от последнего известного (STMT-02) через фасад
    `accounts`; `transactions.changed { ids }` пачкой в той же транзакции.
  - [ ] Агрегации пачками в фасаде (`aggregate(s, { period, groupBy: category | month | counterparty })`) через `calc`:
    переводы не входят в доходы и расходы, возврат уменьшает расходы категории покупки (FIN-01) — тесты-примеры;
    число запросов к БД не растёт с числом категорий.
  - [ ] Карточка операции (боковая панель): все поля, исходное описание, источник категории, курс для валюты
    (`WhyButton`), история изменений.
  - [ ] Инструменты: `search_transactions` и `aggregate_transactions` (`read`, `core`), `add_transaction`
    и `update_transaction` (`write` + `undoToken`), `delete_transaction` (`destructive`); изоляция по реестру зелёная.
  - [ ] Цель `bench`: страница 50 строк на 10 000 операциях — ≤ 150 мс p95 на сервере (замер в итоге).
  - [ ] axe 0 на `/operations` во всех состояниях при 1440 и 390.
- Проверка: make check; make e2e; make bench
- Риск: high — суммы и итоги, которые видит пользователь, и самый нагруженный фасад («бог-модуль», ARCHITECTURE §15)
- Зависимости: T-020, T-019, T-015

### T-022 · Массовые действия и обучение категоризации на исправлениях
- Статус: todo
- Модули: `transactions`, `categories`, `features/operations`
- SPEC: TXN-04, CAT-05, AGT-03, AGT-07
- Экран: Operations — design/screens/Operations.dc.html, `Operations--bulk-selection` (панель массовых действий,
  подтверждение, «Отменить»)
- Критерии приёмки:
  - [ ] Выбор строк → «Сменить категорию / Удалить / Пометить переводом» → `ConfirmDialog` с перечнем («Да, перенести
    13») → ожидающее решение в `actions` → исполнение кодом → «Отменить» возвращает всё как было (int-тест на 23
    операциях).
  - [ ] Ручная смена категории создаёт правило пользователя для контрагента (или товара) и спрашивает «Применить
    к N прошлым операциям?»; «Да» — массовое изменение с отменой; КП CAT: следующая «ТАКСИ 7788» сразу получает
    «Такси» без вызова модели (шпион шлюза).
  - [ ] Инструмент `bulk_change_category` (`destructive`: `propose` → ожидающее действие с количеством и примерами).
  - [ ] axe 0 на `/operations` с выбранными строками и открытым подтверждением при 1440 и 390.
- Проверка: make check; make e2e
- Риск: medium — массовое изменение всегда идёт через подтверждение и откатывается «Отменить»
- Зависимости: T-021

## Фаза 3 · Данные без ручного ввода

Контрольная точка: ответы настоящих моделей — облако по согласию, иначе локально (видно в «Запросы к ИИ»; в Langfuse
текст замаскирован); синтетическая выписка → предпросмотр → импорт → откат; фото чека → анимация проверки →
карточка «Сумма сходится 100%»; чек и платёж по карте из выписки — одна операция.

### T-023 · ИИ-провайдеры: Groq, Z.ai и локальная модель в цепочке, лимиты, журнал и админка
- Статус: todo
- Модули: `llm`, `privacy`, `admin`, `features/admin`
- SPEC: LLM-02, LLM-03, LLM-04, LLM-05, LLM-06, LLM-08, LLM-09, LLM-10, NFR-02, NFR-04, PRIV-02, PRIV-09, ADM-20,
  ADM-21, ADM-22, ADM-50, NOTIF-03, OBS-03, OBS-05
- Экран: Admin — design/screens/Admin.dc.html, вкладки «Провайдеры ИИ» (`Admin--providers`) и «Запросы к ИИ»
  (`Admin--ai-requests`)
- Критерии приёмки:
  - [ ] Адаптеры `@ai-sdk/groq` и `@ai-sdk/openai-compatible` (Z.ai, llama-server); цепочка по умолчанию Groq → Z.ai →
    локальная, по задачам (сид); без Vercel AI Gateway и строк `"provider/model"`.
  - [ ] «Цепочка как одна модель»: ошибка, таймаут или 429 до первого куска потока — отвечает следующий (тесты на
    `MockLanguageModelV4`); лимитёр RPM/TPM/RPD с восстановлением из журнала и заголовков `x-ratelimit-*`, размыкатель
    по `retry-after`; строгая схема с повтором (LLM-04).
  - [ ] КП PRIV-02: у пользователя без облачного согласия во всех вызовах только локальный провайдер (инвариант-тест);
    задачи без данных пользователя — `systemCaller`, облачная цепочка (PRIV-09).
  - [ ] Выбор модели пользователем хранится в настройках; недоступная выбранная модель → отвечает следующая,
    в метаданных ответа «Модель X недоступна, ответила Y».
  - [ ] «Провайдеры ИИ»: порядок цепочки по задачам, включение, «Проверить связь», ключи только для записи, реестр
    моделей (добавить, выключить, возможности, цены, разрешённые пользователям). «Запросы к ИИ»: запросы, токены,
    условная стоимость, время, доля ошибок по задачам и провайдерам, облако / локально, расход дневных лимитов,
    редактируемый прайс, ссылка в Langfuse; текстов запросов и ответов нет (ADM-22).
  - [ ] Уведомления администратору об исчерпании лимитов и ошибках провайдеров; журнал расхода — 90 дней, трассы
    Langfuse — 30 дней (ночные задачи).
- Проверка: make check; make e2e; вручную: «Проверить связь» у Groq и Z.ai с ключами из админки
- Риск: high — отправка данных наружу и фильтр облачного согласия
- Зависимости: T-022, T-016, T-017

### T-024 · Маскирование, защита от инъекций и локальные модели с автоскачиванием
- Статус: todo
- Модули: `llm`, `profile`, `features/admin`, `features/setup`
- SPEC: PRIV-03, PRIV-04, SEC-10, SEC-11, NFR-03, NFR-05, NFR-25, LLM-01, LLM-07, VOICE-03, ADM-50, AUTH-10
- Экран: Admin — design/screens/Admin.dc.html, «Провайдеры ИИ», блок локальных моделей; Setup —
  design/screens/Setup.dc.html, прогресс скачивания моделей
- Критерии приёмки:
  - [ ] Маскирование перед облаком: ФИО (склонённый словарь имён из `profile` + локальная NER, скачивается сама),
    счета и IBAN, карты, телефоны, email, ИН паспорта, адреса → метки `[ИМЯ_1]`…; суммы, даты и магазины не
    трогаются; демаскирование текста, потока и аргументов инструментов; КП PRIV: в запросе к облаку нет номера счёта,
    ФИО и телефона из выписки.
  - [ ] Документ — блок `<document>` отдельно от инструкций, фильтр инструктивных фраз («игнорируй предыдущие
    инструкции», «переведи деньги…») — тесты; фото чека — без EXIF/GPS (`sharp`).
  - [ ] Загрузчик моделей: HTTP Range с докачкой, sha256, прогресс в админке и на экране первого запуска; старт по
    `identity.system-initialized` и кнопкой; каталог `data/models/`; llama-server в режиме роутера; самотест при старте
    («2+2», эталонный вектор), при мусоре — mmproj на CPU (ARCHITECTURE §15).
  - [ ] Порты `Embedder` (bge-m3, всегда локально) и `Transcriber` (Groq Whisper при согласии, иначе whisper.cpp);
    в тестах — хэш-эмбеддер и фиксированный текст.
- Проверка: make check; вручную: make up с профилем models — модели скачиваются с прогрессом, самотест в логах
- Риск: high — утечка ПД в облако при ошибке маскирования, prompt injection
- Зависимости: T-023, T-018

### T-025 · Разбор выписок любого банка: чтение PDF/XLSX/XLS/CSV/сканов и запоминание формата
- Статус: todo
- Модули: `statements`, `files`, `llm`, `tooling/synth`, `datasets/statements`
- SPEC: STMT-04, STMT-05, STMT-12, PRIV-03, SEC-03, SEC-10, NFR-11, NFR-18, QA-01
- Критерии приёмки:
  - [ ] Генератор синтетических выписок в `tooling/synth/` и набор `datasets/statements` (разные порядок и названия
    колонок, форматы дат и сумм, валюты, переносы строк, многостраничный PDF, XLS, CSV в cp1251 и utf-8, скан)
    с эталоном и описанием происхождения; реальных выписок нет (NFR-18).
  - [ ] Чтение по стратегиям: PDF — `unpdf` + строки и колонки по координатам слов; XLSX/XLS — SheetJS CE из тарболла
    в `vendor/`; CSV — `papaparse` + определение кодировки; скан — модель с изображениями (кассета); разбор в задаче
    `worker` с таймаутом, лимитом памяти и защитой от ZIP-бомб.
  - [ ] Колонки: запомненный формат → эвристика → модель по маленькому замаскированному фрагменту (только смысл
    колонок); вторая выписка того же формата разбирается без модели (шпион); изменённый формат замечен и определён
    заново.
  - [ ] Сверка цепочки остатков (`calc`): расхождение → «проверьте», не проходит молча; описание операции — данные,
    не инструкция (кассета с «игнорируй правила…» в назначении).
  - [ ] Весь набор `datasets/statements` даёт ожидаемые операции (int-тесты, офлайн).
- Проверка: make check; pnpm vitest run apps/server/src/modules/statements
- Риск: medium — ошибку разбора ловят сверка остатков и предпросмотр (T-026)
- Зависимости: T-024, T-016

### T-026 · Импорт выписки в учёт: дубли, типы операций, предпросмотр, откат и вкладка выписок
- Статус: todo
- Модули: `statements`, `transactions`, `accounts`, `categories`, `merchants`, `fx-rates`, `actions`,
  `notifications`, `features/documents`, `features/operations`
- SPEC: STMT-01, STMT-02, STMT-03, STMT-04, STMT-06, STMT-07, STMT-08, STMT-09, STMT-10, STMT-11, CAT-06, NOTIF-02,
  NFR-21, TXN-05, AGT-03
- Экран: Documents — design/screens/Documents.dc.html (`Documents--statement-preview`, `--empty`, `--error`; блок
  чеков скрыт до T-028); Operations — импорт и файл в карточке операции
- Критерии приёмки:
  - [ ] Предпросмотр — черновик импорта: «Нашёл 47 операций по карте •• 4821 за 01.09–30.09. 12 уже были» + первые
    строки (сырое описание → контрагент → категория) + «Импортировать 35 / Исправить колонки / Отмена»; спорные
    переводы — пакетом на подтверждение.
  - [ ] КП STMT: повторная загрузка — 0 новых и отчёт о дублях; снятие наличных не увеличивает расходы; перевод на свой
    накопительный не меняет доходы и расходы; USD-операция — BYN по курсу НБРБ на дату, курс в «Откуда эта цифра?».
  - [ ] Дубли по STMT-07; счёт создаётся по банку + маске + валюте; остатки из выписки с датой.
  - [ ] Импорт одной транзакцией + `actions.record` (откат целиком с подтверждением); импорт 300 операций → одно событие,
    ≤ 5 задач пересчёта и ровно одно уведомление «импорт завершён» (CONSTRAINTS).
  - [ ] Прогресс разбора через `events.stream`; инструмент `statement_import_status` (`read`); e2e «импорт выписки».
- Проверка: make check; make e2e
- Риск: high — суммы и дубли операций, которые видит пользователь
- Зависимости: T-025, T-021, T-020

### T-027 · Распознавание чека: QR и дубли, извлечение, арифметический валидатор и перепроверка
- Статус: todo
- Модули: `receipts`, `@kosht/calc`, `llm`, `merchants`, `tooling/synth`, `datasets/receipts`
- SPEC: RCPT-03, RCPT-04, RCPT-05, RCPT-06, RCPT-07, RCPT-14, RCPT-15, PRIV-04, SEC-11, NFR-11, NFR-18
- Критерии приёмки:
  - [ ] Генератор синтетических фото чеков с QR (`tooling/synth/`) и набор `datasets/receipts` (магазины, качество,
    мятые, опечатки) с эталонной разметкой — основа QA-11.
  - [ ] HEIC → JPEG (`heic-decode`) и подготовка `sharp` в `worker`; QR (`zxing-wasm`, локальный `.wasm`) → УИ; дубль
    по УИ, без QR — магазин + дата + время + итог → `RECEIPT_DUPLICATE` «Этот чек уже загружен 12.10» (КП RCPT).
  - [ ] Извлечение в строгую схему RCPT-03 (`receipt-extraction.ts` с `PROMPT_VERSION`); `validateReceipt` в `calc`:
    `кол-во × цена − скидка = сумма строки` и `сумма строк − скидки = итог` с допуском ±0,01 (настройка); тест
    «3 × 2,49 = 8,47 не сходится и называет строку 2».
  - [ ] Перепроверка только спорных строк, ≤ 2 попыток (настройка), прогресс «Перепроверка строки 2…»; КП RCPT: строка,
    исправленная на перепроверке, → «сходится» с историей перепроверки; после попыток — «требует проверки» со спорными
    строками; модель вне транзакции.
  - [ ] Текст чека — данные (кассета с «игнорируй правила…» не меняет поведения); нормализованные наименования
    позиций сохраняются.
- Проверка: make check; pnpm vitest run apps/server/src/modules/receipts packages/calc
- Риск: high — валидатор чека: ошибка в арифметике даёт неверные траты
- Зависимости: T-026, T-024

### T-028 · Чеки в учёте и на экране: загрузка, анимация проверки, карточка «Верно / Изменить / Отменить»
- Статус: todo
- Модули: `receipts`, `transactions`, `categories`, `files`, `features/documents`, `features/operations`,
  `entities/receipt`
- SPEC: RCPT-01, RCPT-02, RCPT-07, RCPT-08, RCPT-09, RCPT-10, RCPT-11, RCPT-12, RCPT-13, DES-03, DES-16, P9, NOTIF-02,
  TXN-01, TXN-05, AGT-03
- Экран: Documents — design/screens/Documents.dc.html (`Documents--scan-checking`, `--scan-result`, `--receipt-panel`);
  MobileScan — design/screens/MobileScan.dc.html (checking, result); Operations — признак и фильтр «есть чек», чек
  с позициями и фото в карточке; кнопка «Сканировать чек» в каркасе
- Критерии приёмки:
  - [ ] До 10 фото за раз (кнопка, перетаскивание; на телефоне — камера или галерея), каждое — своя задача
    `receipts.recognize`; этапы «Читаю чек… → Проверяю арифметику… → итог» с анимацией проверки по строкам
    (`prefers-reduced-motion` учтён).
  - [ ] Чек сохраняется сразу; карточка «Верно / Изменить / Отменить»; редактор позиций пересчитывает статус
    валидатором; статусы с иконками по DES-03; разница «нераспознанный остаток чека» → «Прочее».
  - [ ] Операция чека с разбивкой по категориям позиций (агрегации распределяют траты); без пары — наличная трата или
    предварительная операция «ожидает выписки» на счёте карты либо «Карта, не указана», не меняющая остаток (RCPT-10).
  - [ ] Фото открывается из чека и операции; «Проверить на сайте МНС» открывает сервис, УИ и дата копируются, запросов
    к МНС нет; позиции с гарантией отмечены, событие `receipts.warranty-items-found`; уведомление «чек требует проверки».
  - [ ] Инструменты `get_receipt`, `receipt_status` (`read`); e2e «фото чека → карточка»; axe 0 на `/documents`
    и телефонном сканировании.
- Проверка: make check; make e2e
- Риск: medium — расчёты проверены в T-027, здесь учёт и интерфейс
- Зависимости: T-027, T-021

### T-029 · Сопоставление чека и выписки: автосвязь, вопрос «одна покупка?», ручная связь и разрыв
- Статус: todo
- Модули: `transactions`, `receipts`, `merchants`, `actions`, `notifications`, `features/operations`
- SPEC: TXN-10, TXN-11, RCPT-10, NOTIF-02, NOTIF-05
- Экран: Operations — design/screens/Operations.dc.html, связь и разрыв в карточке; уведомление с «Да / Нет»
  и «Это разные покупки»
- Критерии приёмки:
  - [ ] Кандидат: расход по карте с той же суммой (±0,01, с учётом валюты), дата ±2 дня, похожее название (порог —
    настройка); единственный уверенный — связь автоматически и уведомление «Чек из Евроопта привязан… [Это разные
    покупки]»; несколько или неуверенно — ожидающее решение «одна покупка?» в `actions`.
  - [ ] Сопоставление в обе стороны (при загрузке чека и при импорте выписки); после связи операция одна: сумма и дата
    из выписки, разбивка из чека; `transactions.merged` → `receipts` перепривязывает чек.
  - [ ] КП TXN: чек 47,30 от 12.10 + операция 47,30 от 13.10 «EVROOPT» → одна операция, расходы месяца +47,30; чек до
    выписки сначала наличная трата, после импорта привязан, наличная исчезает.
  - [ ] Ручная связь и разрыв из карточки с «Отменить».
- Проверка: make check; make e2e
- Риск: high — двойной учёт покупки искажает траты и остатки
- Зависимости: T-028, T-026

## Фаза 4 · Живой дашборд

Контрольная точка: дашборд на синтетической истории 6 месяцев — остатки, доходы и расходы, категории, динамика, лимиты
и цели, регулярные платежи, свободный остаток с «Откуда эта цифра?»; клик по категории → отфильтрованные операции;
уведомление 80 % лимита ≤ 3 с; `make bench`: главная ≤ 300 мс p95.

### T-030 · Регулярные платежи и подписки: поиск по истории, «возможно прекращён», экран
- Статус: todo
- Модули: `recurring`, `profile`, `notifications`, `features/recurring`, `features/operations`
- SPEC: REC-01, REC-02, REC-04, REC-05, PROF-03, NOTIF-02, TXN-01, AGT-03
- Экран: Recurring — design/screens/Recurring.dc.html (блок свободного остатка — T-031); Operations — признак «регулярный»
- Критерии приёмки:
  - [ ] Поиск по истории: один контрагент, сумма ±15 %, период (неделя, месяц, квартал, год), ≥ 3 повторов (год — 2),
    дата ±5 дней для ежемесячных — пороги `defineSetting`; доходы и расходы; синтетическая история 6 месяцев →
    ожидаемый список (тесты).
  - [ ] Экран: период, средняя сумма, следующая дата, «подписка»; фильтр Доходы / Обязательные / Подписки;
    подтвердить, исправить, исключить «это не регулярный», добавить вручную.
  - [ ] Через 10 дней после ожидаемой даты — «возможно прекращён» и одно уведомление; пересчёт по
    `transactions.changed` со схлопыванием; событие `recurring.changed`.
  - [ ] Факты-предположения «регулярный доход» и «обязательные платежи» в `profile`; инструменты `list_recurring`,
    `upcoming_payments` (`read`, `planning`).
- Проверка: make check; make e2e
- Риск: medium — ошибки видны и правятся пользователем, но влияют на свободный остаток
- Зависимости: T-029, T-018

### T-031 · Финансовые расчёты: свободный остаток, средний доход и прогноз остатка по дням
- Статус: todo
- Модули: `fin`, `@kosht/calc`, `explain`, `profile`, `features/recurring`
- SPEC: FIN-01, FIN-20, FIN-21, FIN-22, REC-04, PROF-03, EXPL-01, EXPL-02, AGT-03
- Экран: Recurring — design/screens/Recurring.dc.html, формула свободного остатка с «Откуда эта цифра?»
- Критерии приёмки:
  - [ ] `calc`: средний регулярный доход «на руки» за 3 полных месяца, свободный остаток (пример FIN-20 → 840 BYN),
    история меньше 3 месяцев — «по данным за N мес.»; прогноз остатка по дням до конца месяца из остатков и ожидаемых
    регулярных; покрытие `calc` ≥ 95 / 90.
  - [ ] Трасса с операциями-основаниями сохраняется (`explain.save`); на экране — «2 400 − 180 − 35 − 1 200 − 145 =
    840 BYN»; факт «свободный остаток» — предположение в профиле.
  - [ ] Фасад для `budgets`, `afford`, `dashboard`, `weekly`; инструмент `get_free_balance` (`read`, `planning`).
- Проверка: make check; pnpm vitest run packages/calc apps/server/src/modules/fin
- Риск: high — свободный остаток видит пользователь, на нём строятся сценарии покупки
- Зависимости: T-030

### T-032 · Лимиты и цели: прогресс, пороги 80/100 %, копилка и привязка к счёту
- Статус: todo
- Модули: `budgets`, `@kosht/calc`, `notifications`, `actions`, `features/budget`, `entities/limit`, `entities/goal`
- SPEC: BUD-01, BUD-02, BUD-03, BUD-04, BUD-05, BUD-06, BUD-07, NOTIF-02, AGT-03, AGT-05, AGT-07
- Экран: Budget — design/screens/Budget.dc.html (`Budget--new-goal`)
- Критерии приёмки:
  - [ ] КП BUD: лимит 200, траты 160 → 80 % и одно уведомление; до 205 → второе (100 %); новый месяц — с нуля;
    идемпотентность по ключу «лимит + месяц + порог»; «трата → уведомление 80 %» ≤ 3 с (int-тест).
  - [ ] Цели: копилка с историей взносов и привязка к счёту — после импорта с новым остатком прогресс обновляется сам
    (`accounts.balances-changed`); рекомендуемый взнос и «укладывается ли в свободный остаток» — `calc` с тестами
    BUD-05; уведомления 50 %, 100 %, «отстаёт от графика».
  - [ ] Экран: полосы `LimitBar`, новый лимит и правка, удаление лимита или цели — через подтверждение; инструменты
    `list_budgets` (`read`), `set_limit`, `create_goal`, `contribute_to_goal` («отложи 200 на отпуск», `write`),
    `delete_limit`, `delete_goal` (`destructive`).
- Проверка: make check; make e2e
- Риск: medium — проценты и уведомления заметны, расчёты под тестами `calc`
- Зависимости: T-031, T-015

### T-033 · Главный экран: дашборд с периодом, графиками и переходами в операции
- Статус: todo
- Модули: `dashboard`, `features/dashboard`, `entities/explanation`
- SPEC: DASH-01, DASH-02, DASH-03, DASH-04, EXPL-01, REC-03, BUD-02, DES-13, DES-14, DES-15
- Экран: Main — design/screens/Main.dc.html (`Main--loading`, `--empty`, `--why-panel`); MobileHome —
  design/screens/MobileHome.dc.html; виджеты вычетов, календаря, итогов недели и кнопка «Могу ли я позволить
  покупку?» скрыты до фазы 7
- Критерии приёмки:
  - [ ] Период (месяц по умолчанию, произвольный) меняет все цифры; остатки, доходы и расходы, траты по категориям
    (≤ 6 рядов + «Остальное»), динамика по месяцам, лимиты и цели, ближайшие регулярные платежи, свободный остаток —
    у каждого числа `WhyButton` с сохранённой трассой.
  - [ ] Клик по категории или месяцу → `/operations?period=…&category=…` с применённым фильтром; новый пользователь —
    первые шаги вместо пустых графиков.
  - [ ] Сборка пачками без N+1; `make bench`: главная на синтетической истории объёма демо-набора — ≤ 300 мс p95
    (повторный замер на демо — T-054).
- Проверка: make check; make e2e; make bench
- Риск: medium — только чтение готовых чисел
- Зависимости: T-032

## Фаза 5 · Правовая база

Контрольная точка: после первого запуска стартовый каталог (28 актов) загружается сам; гость открывает «Базу законов»,
находит «ст. 210 НК» и читает текст с оглавлением; админка «Законы» и «Таблица ставок»; офлайн-тесты разборщика,
версий и карантина зелёные; `make bench`: гибридный поиск ≤ 200 мс p95, точное обращение ≤ 10 мс.

### T-034 · Каталог актов и вежливый загрузчик pravo.by: стартовый каталог, снимки и фрагменты
- Статус: todo
- Модули: `legal-base`, `notifications`, `features/setup`
- SPEC: LAW-01, LAW-03, LAW-04, LAW-07, LAW-10, LAW-20, LAW-35, LAW-36, LAW-37, LAW-38, LAW-39, AUTH-10, NOTIF-03
- Экран: Setup — design/screens/Setup.dc.html, прогресс загрузки законов
- Критерии приёмки:
  - [ ] `PoliteFetcher`: один поток, 3–5 с между запросами (`FakeClock`), сжатие, честный User-Agent с контактом (пустой
    контакт останавливает загрузчик с сообщением); robots.txt раз в сутки, проверка каждого адреса — КП LAW: запрет
    `/pravovaya-informatsiya/pravovye-akty-po-temam/poisk-v-tbd/?category=…`, разрешение `/document/?guid=3871&p0=…`;
    повторы 30 с / 2 мин / 10 мин; 403/429 или > 20 % ошибок — остановка цикла до следующих суток и уведомление
    администратору. Тесты офлайн на `__fixtures__/pravo-by/*.html` с датой сохранения.
  - [ ] Стартовый каталог SPEC §6.19.1 (28 актов: 23 текстом, 5 карточкой) грузится после
    `identity.system-initialized` без участия человека; переживает перезапуск; прогресс «Загружено 14 из 28»
    на экране первого запуска и в админке.
  - [ ] Разбор `cheerio` во фрагменты по LAW-20 (длинные статьи — по пунктам, указы — по пунктам, путь для поиска,
    «исключена», метаданные, надстрочные номера); сырой HTML снимка (gzip) хранится; Пленумы — тип «разъяснение
    Пленума, не НПА».
  - [ ] Канарейки (Закон № 90-З — 51 статья) и карантин LAW-39; КП LAW: тестовая страница с иной вёрсткой уходит
    в карантин, действующая редакция остаётся, администратор уведомлён.
- Проверка: make check; pnpm vitest run apps/server/src/modules/legal-base
- Риск: high — автоматические запросы к внешнему сайту: нарушение robots или частоты недопустимо
- Зависимости: T-033, T-006

### T-035 · Поиск по законам: точное обращение по реквизитам, гибридный поиск и векторы в фоне
- Статус: todo
- Модули: `legal-base`, `llm`
- SPEC: LAW-08, LAW-09, LAW-21, LAW-22, LAW-23, NFR-05, AGT-03
- Критерии приёмки:
  - [ ] «ст. 210 НК», «п. 3 ст. 13 Закона о защите прав потребителей» → фрагмент по таблице кратких имён без векторов,
    ≤ 10 мс p95 (`make bench`).
  - [ ] Гибрид: FTS `russian` + `halfvec` HNSW, RRF k = 60, словарь «бытовое → юридическое», только действующие
    версии, расширение по ссылкам и определениям, 6–10 фрагментов; ≤ 200 мс p95 SQL на ~25 тыс. синтетических
    фрагментов, `search_law` целиком ≤ 600 мс p95.
  - [ ] Новая редакция ищется по FTS и реквизитам сразу после разбора; векторы — задача `legal-base.embed` только для
    изменённых фрагментов, у вектора имя и версия модели, смена модели — фоновая переиндексация с прогрессом; догрузка
    по требованию с пометкой «акт добавлен в базу только что», предел 20 в сутки + уведомление администратору.
  - [ ] Инструменты `search_law`, `get_law_fragment`, `law_act_card` (`read`, `legal`).
- Проверка: make check; make bench
- Риск: medium — точность поиска проверит eval (T-055); сумм здесь нет
- Зависимости: T-034, T-024

### T-036 · Ежедневное обновление законов: редакции, версии фрагментов, принятые изменения, утрата силы
- Статус: todo
- Модули: `legal-base`, `notifications`
- SPEC: LAW-30, LAW-31, LAW-32, LAW-34, NFR-22, CHAT-10
- Критерии приёмки:
  - [ ] Расписание `legal-base.daily-check` в ночном окне (по умолчанию 04:00 в 02:00–06:00), пропуск догоняется при
    включении; карточки актов индекса — ежедневно, остальных — еженедельно, полная сверка текстов — еженедельно;
    лёгкая проверка — `HEAD` без сжатия.
  - [ ] КП LAW: подмена сохранённой страницы с одной изменённой статьёй → ровно одна новая версия фрагмента
    и векторизация только её; перенумерация по совпадению текста; пропавшие — «исключён»; цитаты ссылаются на
    версию фрагмента (основа CHAT-10).
  - [ ] Принятые, но не вступившие изменения: очередь по акту; с текстом изменяющего акта — предупреждение на уровне
    статьи (модель предлагает, программа проверяет дословно), без текста — на уровне акта; дата вступления — проверка
    на следующий день, через 7 дней без изменений — уведомление администратору.
  - [ ] Утрата силы: акт выходит из поиска, ответ «утратил силу с …» с заменой, если известна; события
    `legal-base.act-updated`, `legal-base.act-repealed`.
- Проверка: make check
- Риск: medium — всё под офлайн-тестами на фикстурах; ошибка видна в журнале обновлений
- Зависимости: T-035

### T-037 · Пополнение каталога: граф ссылок, новые поступления, фильтры, темы и очередь кандидатов
- Статус: todo
- Модули: `legal-base`, `llm`, `notifications`
- SPEC: LAW-02, LAW-11, LAW-12, LAW-13, LAW-14, LAW-15, LAW-17, PRIV-09
- Критерии приёмки:
  - [ ] Граф ссылок на 1 шаг («Законом … от 8 июля 2008 г. № 369-З» → ID pravo.by по правилу реквизитов); новые
    поступления за все пропущенные дни (≤ 30); изменяющий акт — событие внеплановой проверки, а не запись каталога.
  - [ ] Фильтры LAW-13 без модели; КП LAW: кадровый указ из новых поступлений отсекается без вызова модели, причина
    в журнале; тема по рубрикам ЕПК («рубрика → тема»), нет рубрики — «предложенные»; модель (`systemCaller`, облачная
    цепочка) — только для спорных.
  - [ ] Таблица маршрутов LAW-17 — тест на каждую клетку; «добавлять автоматически / только предлагать»; отклонённые
    повторно не предлагаются; журнал спроса — тема и акты без текста вопроса, сводка раз в неделю; ведомственные
    страницы — раз в месяц.
- Проверка: make check
- Риск: medium — расширение каталога обратимо и проходит фильтры
- Зависимости: T-036, T-023

### T-038 · «База законов» для всех: каталог, поиск по статье и читалка с оглавлением
- Статус: todo
- Модули: `legal-base`, `features/laws`, `entities/law`
- SPEC: LEGAL-11, LEGAL-05, LEGAL-06, LAW-07, LAW-32, DES-06, DES-12
- Экран: Laws — design/screens/Laws.dc.html (`Laws--article-reader`, `Laws--guest`)
- Критерии приёмки:
  - [ ] Публичный `/laws` (`publicProc`, гость без меню): все акты каталога со статусом, датой редакции, темой; поиск
    по названию и «ст. 210 НК»; фильтры по теме и статусу.
  - [ ] Читалка: оглавление по структуре, текст Literata, «редакция по состоянию на <дата снимка>», предупреждение
    о принятых изменениях, ссылка на pravo.by у каждого акта; акт «только карточка» — без текста, со ссылкой.
  - [ ] axe 0 на `/laws` (гость и пользователь) и в читалке при 1440 и 390.
- Проверка: make check; make e2e
- Риск: low — только чтение публичных данных
- Зависимости: T-037

### T-039 · Раздел «Законы» в админке: состояние базы, журналы, кандидаты и справочники
- Статус: todo
- Модули: `legal-base`, `admin`, `features/admin`
- SPEC: LAW-40, ADM-10, LAW-06, LAW-16
- Экран: Admin — design/screens/Admin.dc.html, вкладка «Законы» (`Admin--index-building`)
- Критерии приёмки:
  - [ ] Сводка (в индексе, только карточкой, утратили силу, кандидаты, прогресс векторов), последняя и следующая
    проверка, ночное окно, автообновление, «добавлять автоматически / только предлагать», контакт загрузчика.
  - [ ] Список актов со статусами («актуален», «есть принятые изменения», «только карточка», «утратил силу», «на
    карантине», «ошибка»), журнал обновлений и запросов загрузчика, очередь кандидатов с причинами и «Добавить /
    Отклонить».
  - [ ] Кнопки «Проверить сейчас», «Добавить акт по ссылке», «Добавить списком» (в том числе местные акты),
    «Проверить, появился ли текст», «Исключить акт»; редакторы: стартовый каталог, «рубрика ЕПК → тема», шаблоны
    заголовков, словарь органов, краткие имена, «бытовое → юридическое», ведомственные страницы.
- Проверка: make check; make e2e
- Риск: medium — действия администратора над общей базой без пользовательских данных
- Зависимости: T-038, T-017

### T-040 · Таблица ставок с подтверждением человеком и сверка после обновления законов
- Статус: todo
- Модули: `norm-tables`, `legal-base`, `notifications`, `admin`, `features/admin`
- SPEC: TAX-03, LAW-33, LEGAL-08, ADM-11, AFF-05, CAL-02, NOTIF-03
- Экран: Admin — design/screens/Admin.dc.html, вкладка «Таблица ставок» (`Admin--rates`)
- Критерии приёмки:
  - [ ] Таблица «параметр → период → значение → источник (акт, статья, пункт, версия фрагмента) → кто и когда
    подтвердил»; фасад отдаёт только подтверждённые значения; значения на год нет — явный ответ «нет данных».
  - [ ] Начальное наполнение — значения 2026 г. из SPEC §9.1, сверенные с первоисточником, со статусом «подтверждено
    разработчиком, <дата>»; пределы ПДН 40 / 50 % (§9.3); прошлые годы и изменения — только после «Подтвердить»
    в админке, с историей.
  - [ ] КП LAW-33: по `legal-base.act-updated` другое число во фрагменте ставки → уведомление администратору и пометка,
    ставка сама не меняется.
  - [ ] Заведена структура правил сроков для CAL-02 (данные сроков вносит T-048).
- Проверка: make check; make e2e
- Риск: high — по этим числам считаются налоги и безопасный платёж
- Зависимости: T-039, T-036

### T-041 · Правовой консультант: дословные цитаты, «в моей базе нет» и чек-листы документов
- Статус: todo
- Модули: `legal-consult`, `legal-base`, `norm-tables`
- SPEC: LEGAL-01, LEGAL-02, LEGAL-03, LEGAL-04, LEGAL-05, LEGAL-06, LEGAL-07, LEGAL-08, LEGAL-10, LEGAL-12, P3
- Критерии приёмки:
  - [ ] Метки `[[F12.2]]` → дословный текст версии фрагмента, дата редакции, ссылка на pravo.by, предупреждение
    о принятых изменениях; вольная цитата проверяется с нормализацией пробелов и кавычек, непрошедшая заменяется
    ссылкой с пометкой (unit-тесты нормализации, NFR-11).
  - [ ] Нет фрагментов — ответ «в моей базе нет» с актом из каталога, если известен; акт без текста — ссылкой без
    цитаты; вопрос о прошлой дате — ставка из `norm-tables` и честное «прежнюю редакцию процитировать не могу»;
    пометка «Не является юридической консультацией».
  - [ ] Чек-листы LEGAL-12 (вычет на обучение, на жильё, стандартные на детей и прочие по ст. 209, возврат товара
    надлежащего и ненадлежащего качества, гарантия) — шаблоны, содержание сверено с первоисточниками (ссылки
    в шаблоне); состояние галочек — `userOwnedTable`.
- Проверка: make check
- Риск: high — правовые ответы только по источнику (P3); недословная цитата недопустима
- Зависимости: T-040, T-035

## Фаза 6 · Ассистент

Контрольная точка: чат на сайте и панель «Спросить ассистента»: «Потратил 15 рублей на кофе» → операция с «Отменить»;
«Удали все траты за вчера» → подтверждение; правовой вопрос → дословные цитаты с датой редакции и ссылкой на pravo.by;
вопрос не по теме → вежливый отказ; голос на localhost; все сценарии агента на кассетах зелёные.

### T-042 · Агент целиком: наборы инструментов, стражи, проверка чисел, дозапрос и подтверждения
- Статус: todo
- Модули: `agent`, `llm`, `actions`, `profile`, `legal-consult`
- SPEC: AGT-01, AGT-02, AGT-03, AGT-04, AGT-05, AGT-06, AGT-07, AGT-08, AGT-09, AGT-10, AGT-11, AGT-12, AGT-13,
  SEC-10, PROF-04, LLM-10, NFR-19, P1, P6
- Критерии приёмки:
  - [ ] Реестр собирает инструменты всех готовых модулей; агентские `calculator` (через `calc`, с трассой),
    `make_chart`, `page_context`, `ask_user` (без `execute`, ответ → факт `profile`); набор `core | legal | planning |
    reports` выбирается правилами по странице и словам без облачной модели; префикс постоянен и ≤ 3 000 токенов
    с полным `core`.
  - [ ] Стражи: «вне темы» и защитный классификатор до цикла (правила → локальные эмбеддинги → малая модель),
    проверка чисел ответа, постобработка цитат `legal-consult`; короткое «да» распознаётся до запуска агента
    и вызывает `actions.confirm`.
  - [ ] Сценарии на кассетах (`*.agent.test.ts`), КП AGT: «Потратил 15 рублей на кофе» → операция «Кафе, рестораны
    и доставка», «Отменить» удаляет её; «Удали все траты за вчера» → список и количество, без «Да» ничего не удалено;
    вопрос на 5 инструментов выполняется, при пределе 2 — честное «не успел»; ни одного числа вне результатов
    инструментов; «а в августе?» после сентября; вопрос по-белорусски → ответ по-русски; сбой инструмента →
    «не получилось, повторить?».
  - [ ] Тон AGT-09, без советов по банкам и продуктам (P6); выбранная пользователем модель — первая в цепочке запуска.
- Проверка: make check; pnpm vitest run apps/server/src/modules/agent
- Риск: high — prompt injection и действия агента над данными пользователя
- Зависимости: T-041, T-010, T-018

### T-043 · Чат на сайте: диалоги, панель «Спросить ассистента», вложения, голос и выбор модели
- Статус: todo
- Модули: `chat`, `voice`, `agent`, `features/assistant`, `apps/web/src/lib`
- SPEC: CHAT-01, CHAT-02, CHAT-03, CHAT-07, CHAT-08, CHAT-09, VOICE-02, VOICE-03, LLM-10, PRIV-02, SEC-02, SEC-05,
  DES-10, DES-11, NFR-21
- Экран: Assistant — design/screens/Assistant.dc.html (`Assistant--local-mode`, `--new-dialog`); MobileChat —
  design/screens/MobileChat.dc.html; Main — `Main--assistant-panel` (плавающая кнопка во всём каркасе)
- Критерии приёмки:
  - [ ] Диалоги: создать, переименовать, удалить, название по первому сообщению; поток с подписями шагов из словаря
    `tools`; лента `role="log"` + живая область только для вех; Markdown санитизирован (без HTML и картинок, ссылки —
    только внутренние и pravo.by; тест на вредную разметку).
  - [ ] Плавающая кнопка на всех страницах открывает панель (на телефоне — полноэкранный маршрут) с `PageContext`
    (раздел, период, фильтры, объект): на дашборде за сентябрь «почему так много на такси?» — агент получает сентябрь
    (тест); подсказки быстрых вопросов.
  - [ ] Вложения (фото чека, файл выписки) идут конвейерами `receipts` и `statements`, результат — карточкой в чате.
  - [ ] Микрофон только на `localhost` → `voice` (облако при согласии, иначе whisper.cpp) → текст в поле для правки;
    по сети — подсказка «Надиктуйте в Telegram».
  - [ ] Выбор модели («Авто» или из разрешённых; без согласия — только локальные), пометка «Модель X недоступна,
    ответила Y»; плашка «Локальный режим: ответы медленнее» со ссылкой на настройку; ограничение частоты запросов
    к ассистенту.
  - [ ] e2e «вопрос в чате»; первое событие потока ≤ 1 с на кассетах; чанк чата ≤ 200 КБ gzip.
- Проверка: make check; make e2e; make check-full
- Риск: medium — вывод ответа модели и вложения; права проверяет сервер
- Зависимости: T-042, T-028, T-026, T-024

### T-044 · Карточки ответа и цитаты законов в чате
- Статус: todo
- Модули: `chat`, `legal-consult`, `features/assistant`, `entities/transaction`, `entities/receipt`, `entities/law`
- SPEC: CHAT-04, CHAT-05, CHAT-06, CHAT-10, LEGAL-03, LEGAL-07, LEGAL-09, DES-12, AGT-02, AGT-05, AGT-07
- Экран: Assistant — design/screens/Assistant.dc.html: карточки чека, операции, чек-листа, мини-графика,
  подтверждения; чипы статей с цитатой (Popover на компьютере, нижняя шторка на телефоне)
- Критерии приёмки:
  - [ ] Реестр частей сообщения `tool-<имя>` / `data-<вид>` → компонент с безопасным запасным видом; карточки: чек,
    операция с «Отменить / Изменить», чек-лист с сохраняемыми галочками, мини-график (≤ 6 рядов), подтверждение
    массового действия; карточки вычета и сценариев покупки подключат T-045 и T-049.
  - [ ] `[[F…]]` → `LawRefChip` → `LawQuote` (Literata, «Редакция на …», ссылка на pravo.by); под правовыми ответами —
    «Не является юридической консультацией»; ответ со статьёй, изменившейся позже, помечен «статья изменилась после
    ответа».
  - [ ] Сценарии на кассетах: правовой вопрос → только дословные цитаты базы; «купил пылесос 10 дней назад, хочу
    вернуть» → чек найден, срок 14 дней посчитан кодом, чек-лист возврата (LEGAL-09); «сколько потратил на кафе за лето
    и сколько сэкономлю, если урежу на треть» → цепочка инструментов и мини-график (AGT-02).
  - [ ] axe 0 на `/assistant` со всеми видами карточек при 1440 и 390.
- Проверка: make check; make e2e
- Риск: medium — цитаты проверяет `legal-consult`, интерфейс только отображает
- Зависимости: T-043, T-041

## Фаза 7 · Выгода и планирование

Контрольная точка: калькулятор вычетов и найденный вычет на главной; календарь с налоговыми сроками, гарантиями
и напоминаниями; «Могу ли я позволить покупку?» с тремя сценариями; итоги недели; Excel с живыми формулами; дашборд
со всеми виджетами DASH-02.

### T-045 · Налоговые вычеты: калькулятор по ст. 209–211 с учётом типа занятости
- Статус: todo
- Модули: `tax`, `@kosht/calc`, `norm-tables`, `legal-consult`, `features/deductions`, `features/assistant`
- SPEC: TAX-01, TAX-02, TAX-04, TAX-05, TAX-06, TAX-07, PROF-06, LEGAL-12, CHAT-04, AGT-03
- Экран: Deductions — design/screens/Deductions.dc.html (калькулятор Обучение / Жильё / Дети, способ получения,
  чек-лист); Assistant — карточка расчёта вычета
- Критерии приёмки:
  - [ ] Все примеры TAX-07 — тесты `calc`: обучение 2 000 → экономия 260 BYN (при меньшем доходе остаток переносится);
    квартира 120 000 → до 15 600 BYN, 48 мес. при начисленной 2 500, ≈ 41 мес. при 2 500 «на руки»; двое детей →
    240 BYN в месяц, 31,20 / 374,40 BYN (суммы 2026 г. из таблицы ставок).
  - [ ] КП TAX: только НПД — вычет не считается и объясняется почему; ИП и несколько видов дохода — по TAX-02;
    «на руки / 0,86» с пометкой «оценка» и дозапросом (TAX-04); правила TAX-05.
  - [ ] Результат: экономия за год и итого, срок, способ получения, формула в «Откуда эта цифра?», дословные цитаты
    норм, чек-лист; значения — только подтверждённые из `norm-tables`.
  - [ ] Инструменты `calculate_deduction`, `deduction_checklist` (`read`, `legal`); карточка вычета в чате; e2e «расчёт
    вычета».
- Проверка: make check; make e2e
- Риск: high — суммы налоговой экономии, которые видит пользователь
- Зависимости: T-044, T-040, T-041

### T-046 · Найденные вычеты: поиск оснований по операциям, карточка на главной, «Не моё»
- Статус: todo
- Модули: `tax`, `profile`, `notifications`, `features/deductions`, `features/dashboard`
- SPEC: TAX-20, DASH-02, NOTIF-02, AGT-06, AGT-03
- Экран: Deductions — design/screens/Deductions.dc.html, блок найденных вычетов; Main — design/screens/Main.dc.html,
  янтарная карточка найденного вычета («Это не моё» с «Отменить»)
- Критерии приёмки:
  - [ ] По `transactions.changed` и `profile.facts-changed`: оплата обучения (категория «Образование», получатель —
    учреждение образования) → социальный вычет с суммой калькулятора; жильё — при учёте нуждающихся (не отмечено —
    один вопрос); дети — напоминание о стандартном вычете.
  - [ ] КП TAX: после загрузки выписки с оплатой обучения появляется «можно вернуть до 260 BYN»; «Не моё» больше не
    предлагается; статусы новый / показан / отклонён / оформлен; уведомление «найден вычет».
  - [ ] Инструмент `found_deductions` (`read`, `legal`).
- Проверка: make check; make e2e
- Риск: high — сумма «можно вернуть» видна на главной
- Зависимости: T-045, T-033

### T-047 · Календарь: события, напоминания, регулярные платежи и гарантии
- Статус: todo
- Модули: `calendar`, `recurring`, `receipts`, `notifications`, `actions`, `features/calendar`,
  `entities/calendar-event`, `features/dashboard`
- SPEC: CAL-01, CAL-03, CAL-04, CAL-06, CAL-07, CAL-08, REC-03, RCPT-13, NFR-22, NOTIF-02, DASH-02, AGT-03
- Экран: Calendar — design/screens/Calendar.dc.html (месяц, `Calendar--list-view`); Main — ближайшие события
- Критерии приёмки:
  - [ ] Вид месяцем и списком «ближайшие» с иконкой типа, суммой, источником; свои события на сайте и инструментом
    `create_event` («напомни 1 декабря оплатить садик», `write`); удаление — с подтверждением.
  - [ ] Даты регулярных платежей и кредитов из `recurring` (`recurring.changed`); гарантия по
    `receipts.warranty-items-found` — 2 года с даты покупки (ст. 21 Закона № 90-З), изменяемо, напоминание за 30 дней.
  - [ ] Напоминания — таблица `reminders` + тик раз в минуту, за 7 и 1 день (настраивается), на сайте (Telegram —
    T-053); пропуск при выключенном компьютере догоняется (тест на `FakeClock`).
  - [ ] Инструмент `list_events` (`read`, `planning`); блок событий на главной.
- Проверка: make check; make e2e
- Риск: medium — напоминания заметны, сумм здесь нет
- Зависимости: T-046, T-030, T-028

### T-048 · Налоговые сроки и страховки: правила по фактам профиля, вопрос об имуществе, ОСАГО и КАСКО
- Статус: todo
- Модули: `calendar`, `norm-tables`, `profile`, `features/calendar`
- SPEC: CAL-02, CAL-05, PROF-07
- Экран: Calendar — design/screens/Calendar.dc.html, баннер «У вас есть автомобиль?», события налогов и страховок
- Критерии приёмки:
  - [ ] Сроки налога на недвижимость, земельного, транспортного, НПД и декларации — правила в `norm-tables` со ссылкой
    на норму; даты сверены с первоисточниками (SPEC O4), источники — в итоге задачи; срабатывают только при фактах
    профиля; `norm-tables.values-confirmed` пересчитывает сроки.
  - [ ] Факты об имуществе выводятся из операций как предположения; один вопрос при первом открытии календаря или
    первом выводе («У вас есть автомобиль? Тогда я напомню о транспортном налоге и ОСАГО»).
  - [ ] Годовой платёж страховой компании → «Похоже, вы оплатили ОСАГО 12.03 — напомнить 5 марта следующего года?»;
    страховка вручную.
- Проверка: make check; make e2e
- Риск: high — налоговые сроки, которые видит пользователь, — только из первоисточника
- Зависимости: T-047, T-040

### T-049 · «Могу ли я позволить покупку?»: три сценария, просадки и безопасный платёж по ПДН
- Статус: todo
- Модули: `afford`, `@kosht/calc`, `fin`, `calendar`, `norm-tables`, `features/afford`, `features/dashboard`,
  `features/assistant`
- SPEC: AFF-01, AFF-02, AFF-03, AFF-04, AFF-05, AFF-06, AFF-07, AFF-08, CAL-08, FIN-22, DASH-02, CHAT-04, AGT-03
- Экран: Afford — design/screens/Afford.dc.html (`Afford--sum-1500`); Main — кнопка «Могу ли я позволить покупку?»;
  Assistant — карточка сценариев
- Критерии приёмки:
  - [ ] Три сценария кодом (сейчас, после следующего дохода, накопить) с прогнозом остатка по дням на 2–3 месяца,
    минимумом и его датой; предупреждение о просадке ниже обязательных платежей или нуля с датой и суммой; КП AFF: при
    известных доходах, платежах и остатках все числа карточки воспроизводятся тестом.
  - [ ] ПДН: 40 / 50 % из `norm-tables`, безопасный платёж = предел × доход − текущие платежи; аннуитет по ставке
    и сроку пользователя — тесты-примеры AFF-05; доход «на руки» помечен оценкой; нет регулярного дохода — дозапрос
    и «оценка по вашим данным».
  - [ ] Ползунок и быстрые суммы пересчитываются на сервере; у каждого числа `WhyButton`; КП AFF: в ответе нет названий
    банков и кредитных программ (кассета).
  - [ ] Инструменты `afford_scenarios`, `safe_loan_payment` (`read`, `planning`); карточка в чате.
- Проверка: make check; make e2e
- Риск: high — суммы, по которым пользователь принимает решение о покупке и кредите
- Зависимости: T-048, T-031, T-032

### T-050 · Итоги недели: числа кодом, текст моделью, карточка на главной
- Статус: todo
- Модули: `weekly`, `@kosht/calc`, `llm`, `notifications`, `features/dashboard`, `features/settings`
- SPEC: WEEK-01, WEEK-02, WEEK-03, NOTIF-02, NFR-22, DASH-02
- Экран: Main — design/screens/Main.dc.html, карточка итогов недели; Settings — design/screens/Settings.dc.html,
  «Уведомления» (день и время, выключение)
- Критерии приёмки:
  - [ ] Понедельник 09:00 (настройка) через `defineSweep`: траты недели, сравнение со средним за 8 недель,
    топ-категории, лимиты, платежи и события недели, найденные вычеты — `calc` с трассой; модель пишет текст только по
    готовым числам (страж чисел, кассета).
  - [ ] Выключенный в понедельник компьютер — один общий итог при запуске; история итогов хранится; карточка на главной;
    отправка в бот — T-053.
- Проверка: make check; make e2e
- Риск: medium — числа из `calc`, текст проверяет страж чисел
- Зависимости: T-049

### T-051 · Экспорт в Excel с живыми формулами
- Статус: todo
- Модули: `xls-export`, `files`, `features/operations`, `features/dashboard`
- SPEC: XLS-01, XLS-02, XLS-03, XLS-04, AGT-03
- Экран: Operations — design/screens/Operations.dc.html, «Выгрузить в Excel»; Main — кнопка Excel
- Критерии приёмки:
  - [ ] ExcelJS: «Операции», «Сводка» (`SUMIFS` по целым столбцам: категории × месяцы, доходы, расходы, разница),
    «Лимиты» (факт формулой, процент); у каждой формулы кэш-результат; формат BYN, палитра и шрифт DES, закреплённые
    заголовки, фильтры; без диаграмм.
  - [ ] КП XLS: тест открывает файл, меняет сумму на «Операциях», пересчитывает HyperFormula (dev-зависимость) и получает
    новый итог категории.
  - [ ] Инструмент `export_excel` (`write`, `reports`); e2e «выгрузка в Excel».
- Проверка: make check; make e2e
- Риск: low — файл только читает данные пользователя
- Зависимости: T-050

## Фаза 8 · Каналы, показ, качество

Контрольная точка: бот — привязка одной кнопкой, фото чека, файл выписки, вопрос голосом, уведомления с кнопками,
команды; «Войти как демо-пользователь» → живой дашборд; `make eval` и вкладка «Качество»; `make check-full` зелёный
(e2e 5–8 сценариев, axe на всех маршрутах, бюджеты бандла, audit); `make init && make up` на чистой машине — готово
к показу.

### T-052 · Telegram-бот: привязка с согласием, чеки, выписки и вопросы ассистенту
- Статус: todo
- Модули: `telegram`, `chat`, `agent`, `privacy`, `identity`, `voice`, `features/settings`, `features/admin`
- SPEC: TG-01, TG-02, TG-03, TG-04, TG-05, TG-10, TG-11, PRIV-08, AGT-11, VOICE-01, LLM-10, AUTH-11, ADM-60
- Экран: Telegram — design/screens/Telegram.dc.html; Settings — design/screens/Settings.dc.html, вкладка «Telegram»
  (`Settings--telegram`); Admin — «Система», токен бота
- Критерии приёмки:
  - [ ] grammY только в `telegram/infrastructure`, long polling под advisory lock (второй экземпляр не опрашивает);
    токен — секрет только для записи, смена перезапускает только `bot`.
  - [ ] Привязка одной кнопкой: предупреждение и согласие PRIV-08 → ссылка с одноразовым коротким кодом → «Старт» →
    «Готово, аккаунт подключён», на сайте «Telegram: подключён ✓»; один аккаунт — один чат; отключение кнопкой
    и `/unlink` отзывает согласие; непривязанному — «Подключите аккаунт: Настройки → Telegram»; заблокированному —
    понятное сообщение; группы не поддерживаются.
  - [ ] Фото чека → карточка «Евроопт, 14 позиций, 47,30 BYN ✓» с «Верно / Изменить / Отменить»; файл выписки →
    «Найдено 47, 12 уже были. Импортировать 35?»; текст и голос — тот же агент со своей историей, `/new` и 6 часов
    тишины сбрасывают контекст; дата «сегодня» — по времени отправки; поток — `sendMessageDraft` (запасной —
    `editMessageText` ≤ 1/с); выбор модели командой.
  - [ ] Тесты — трансформер grammY, записывающий вызовы, без сети; удаление аккаунта разрывает привязку.
- Проверка: make check; вручную: привязка и фото чека в реальном боте
- Риск: high — данные пользователя уходят через серверы Telegram (отдельное согласие)
- Зависимости: T-051, T-043

### T-053 · Бот как канал уведомлений и быстрые команды
- Статус: todo
- Модули: `telegram`, `notifications`, `actions`, `dashboard`, `budgets`, `weekly`, `identity`, `features/settings`
- SPEC: TG-06, TG-07, TG-08, TG-09, NOTIF-01, NOTIF-04, NOTIF-05, AUTH-05, WEEK-01, BUD-03, CAL-07
- Экран: Telegram — design/screens/Telegram.dc.html (`Telegram--commands`); Settings — столбец Telegram во вкладке
  «Уведомления»
- Критерии приёмки:
  - [ ] Канал `telegram` в реестре доставки: все виды NOTIF-02 (кроме отключённых) с кнопками; «Да / Нет» вызывает тот же
    `actions.confirm` (повтор — без эффекта); лимиты, напоминания календаря и итоги недели (понедельник 09:00) приходят
    в бот.
  - [ ] Меню команд `/balance`, `/week`, `/limits`, `/undo` (последнее действие через бот за 24 ч), `/new`, `/unlink`,
    `/help`; длинные ответы и графики — кратко, картинкой графика и «Открыть на сайте».
  - [ ] «Сбросить пароль» в боте присылает ссылку сброса; сброс из админки уходит и в Telegram (AUTH-05).
- Проверка: make check
- Риск: medium — канал доставки поверх готовых механизмов
- Зависимости: T-052, T-050, T-047

### T-054 · Демо-пользователь: связный набор данных от текущей даты
- Статус: todo
- Модули: `demo`, `identity`, `features/auth`, `features/admin`
- SPEC: DEMO-01, DEMO-02, DEMO-03, DEMO-04, ADM-60
- Экран: Login — design/screens/Login.dc.html, «Войти как демо-пользователь» (только localhost); Admin —
  design/screens/Admin.dc.html, «Пересоздать демо-данные» и отметка «демо» в «Пользователях»
- Критерии приёмки:
  - [ ] Набор по DEMO-01 и истории `design/demo-data.md` (6 месяцев, белорусские контрагенты, зарплата и аванс, кредит,
    накопительный, переводы, снятия, валюта; 5–10 чеков с синтетическими фото — один с перепроверкой, один «требует
    проверки»; двое детей; лимиты на 80 % и превышенный; копилка и цель по счёту; налог, ОСАГО, гарантия; оплата
    обучения с найденным вычетом; история итогов недели) — только через фасады модулей.
  - [ ] Воспроизводимо: одинаковые сид и дата → одинаковые данные (тест); относительно текущей даты; создаётся при
    первом запуске, облачное согласие выдано; реальным пользователям не виден и не мешает (изоляция); цель
    `demo-reset` и кнопка в админке.
  - [ ] `make bench` на демо: главная ≤ 300 мс p95; e2e «демо-вход → живой дашборд».
- Проверка: make check; make e2e; make bench
- Риск: medium — пересоздание трогает только данные демо-пользователя
- Зависимости: T-053

### T-055 · Проверка качества ИИ: eval-прогоны с бюджетом токенов и вкладка «Качество»
- Статус: todo
- Модули: `quality`, `llm`, `features/admin`, `datasets/`
- SPEC: QA-10, QA-16, NFR-12, PRIV-09, ADM-40, LAW-23, CAT-03
- Экран: Admin — design/screens/Admin.dc.html, вкладка «Качество» (`Admin--quality`)
- Критерии приёмки:
  - [ ] Цель `eval` и кнопка «Запустить проверку» (предупреждение о лимитах, в фоне, бюджет токенов, возобновление) —
    вне `make test`; наборы QA-11 (чеки), QA-12 (правовые вопросы, в том числе «вне базы»), QA-13 (выписки), QA-14
    (категоризация), QA-15 (агент).
  - [ ] Результаты с датой, провайдером и моделью в БД, сравнение с прошлым прогоном; метрики КП RCPT (точность итога
    и позиций, доля «сходится»), «0 недословных цитат» (КП LEGAL), доля операций демо-набора, категоризированных без
    модели (КП CAT).
  - [ ] Модель эмбеддингов выбрана замером скорости на 500 фрагментах и качества на QA-12 (LAW-23); результат —
    в итоге задачи.
- Проверка: make check; вручную: make eval (тратит лимиты API — запускает пользователь)
- Риск: medium — тратит лимиты API, на данные пользователей не влияет
- Зависимости: T-054, T-042
