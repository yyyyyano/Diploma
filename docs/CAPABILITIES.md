# Карта модулей «Кошта»

> **Источник правды о модулях — `tooling/architecture/modules.ts`; таблицы генерируются, не править.**
> Таблицы ярусов (между метками `capabilities:tier-N`) собирает `make capabilities` из карты (`id`, `tier`,
> `dependsOn`, `tables`, требования, ответственность, события; `userData` и `systemTables` выводятся из `tables`).
> Меняется модуль — правится `modules.ts`, и в том же коммите перегенерируется этот файл; остальной текст
> правится руками. Из той же карты генерируются правила dependency-cruiser и области коммитов commitlint.
> Как модули устроены и общаются — `docs/ARCHITECTURE.md` §4–5; почему так — ADR-0003, ADR-0004.
> Сверено со SPEC 2026-10-24: у каждого раздела §6 и сущности §5 есть модуль-владелец, у каждого модуля — требования.

## Как читать

- **id** — постоянное имя модуля (kebab-case): папка `apps/server/src/modules/<id>/`, область коммита,
  префикс событий и задач (`receipts.recognized`, `receipts.recognize`). Не переименовывается.
- **Ярус** — 1 основа · 2 данные и знания · 3 расчёты и представления · 4 входы и оркестрация.
  Ярус 0 — `platform/` (не модуль). Зависеть можно от модулей своего или нижнего яруса, без циклов;
  наверх — только событием или через реестр.
- **Зависит от** — чьи фасады модуль может вызывать (и на чьи события подписываться). Всё, чего нет
  в списке, запрещено проверкой `make deps-check`.
- **Таблицы** — вид таблиц модуля: `user` — `userOwnedTable` (данные домохозяйства, `ScopedDb`),
  `system` — `systemTable`, `public` — `publicTable` (законы, курсы, справочники). Модуль с `system`/`public`
  получает `SystemDb` (признак `systemTables`, выводится из `tables`); модулю `admin` пользовательские таблицы
  недоступны (PRIV-07).
- **Публикует** — ключевые события (полный список — `events.ts` модуля и его паспорт).

## Ярус 1 — основа

<!-- capabilities:tier-1 -->
| id | SPEC | Ответственность | Зависит от | Таблицы | Публикует |
|---|---|---|---|---|---|
| `files` | SEC-03, RCPT-11, STMT-10, PRIV-05/06 | приём файлов (тип по содержимому, лимиты), хранение `data/files/<householdId>/`, выдача владельцу, удаление | — | user | — |
| `explain` | EXPL-01/02, P2 | хранит трассы `{value, trace}` рядом с результатом, отдаёт объяснение по `traceId` | — | user | — |
| `actions` | P5, AGT-05/07, TXN-03/04, TXN-10 (вопрос «одна покупка?»), TG-07 `/undo`, NOTIF-05 | журнал отменяемых действий; ожидающие решения «Да/Нет» — подтверждения удаления и массовых действий, вопрос «чек и платёж по карте — одна покупка?» (одинаково на сайте, в боте и в чате, ARCHITECTURE §5); реестры обработчиков отмены и ответов | — | user | — |
| `privacy` | PRIV-01/02/05/06/08, AUTH-02 | согласия с версией текста; экспорт и удаление аккаунта через реестр владельцев данных; политика ПД | files | user, system | `privacy.consent-changed`, `privacy.export-ready` |
| `mail` | AUTH-03/04/06, ADM-60 | SMTP, локальный почтовый ящик (только localhost), тестовое письмо | — | system | — |
| `identity` | AUTH-01…12, ROLE-01/02, SEC-01/02, ADM-01, ADM-30, DEMO-04 (вход) | Better Auth (ядро) + первый запуск, код восстановления, роли, блокировка, последний админ, демо-вход, домохозяйство | mail, privacy | system | `identity.system-initialized`, `identity.user-registered`, `identity.user-deleted` |
| `notifications` | NOTIF-01…05, BUD-03, CAL-07 (доставка) | уведомления, центр, настройки по видам и каналам, реестр каналов доставки (web, telegram) | identity | user, system | — |
| `llm` | LLM-01…10, NFR-04/05/25, PRIV-02/03/04/09, OBS-03, ADM-20/21/22/50 | реестр моделей, адаптеры, цепочки по задачам, лимитёр, маскирование, журнал расхода, Langfuse, эмбеддинги, речь, локальные модели | privacy, identity, notifications | system, user | `llm.local-models-ready` |
| `system` | ADM-60, NFR-22/24, OBS-05/07 | обзор фоновых задач, доступ из сети, резервная копия, часовой пояс, статус Langfuse | — | system | — |
<!-- /capabilities:tier-1 -->

## Ярус 2 — данные и знания

<!-- capabilities:tier-2 -->
| id | SPEC | Ответственность | Зависит от | Таблицы | Публикует |
|---|---|---|---|---|---|
| `profile` | PROF-01…07, AGT-06 (факты), AUTH-07 | факты (анкета, чат, выводы системы), статусы «подтверждён/предположение», «Что ассистент знает обо мне» | identity | user | `profile.facts-changed` |
| `fx-rates` | STMT-09 | курсы НБРБ по ISO-коду, кэш, эквивалент в BYN с трассой | explain | public | — |
| `merchants` | STMT-06, CAT-03 (справочник), RCPT-15, TXN-10 (похожесть) | очистка названий, справочник контрагентов РБ, алиасы, нечёткое сравнение, нормализация товаров | llm | public | — |
| `categories` | CAT-01…07, RCPT-09, CAT-04 | встроенные категории (общие) и свои (домохозяйства), правила, гибридная категоризация пакетами | merchants, llm | public, user | — |
| `accounts` | STMT-01/02 | счета, «Наличные», «Карта, не указана», остатки и дата остатка; пересчёт остатка по операциям (STMT-02) выполняет по вызову `transactions` — сам от `transactions` не зависит | identity, fx-rates, explain | user | `accounts.balances-changed` |
| `transactions` | TXN-01…11, FIN-01, STMT-07/08 (запись), CAT-05 (применить к прошлым) | операции, разбивка по категориям, переводы и возвраты, предварительные, сопоставление чек ↔ выписка, массовые действия, агрегации пачками; вызывает фасад `accounts` для пересчёта остатка (STMT-02) | accounts, categories, merchants, fx-rates, actions, explain, notifications | user | `transactions.changed`, `transactions.merged` |
| `statements` | STMT-03…12, SEC-10/11 (документы) | импорт: чтение PDF/XLSX/XLS/CSV/сканов, определение колонок, запоминание формата, дубли, типы, предпросмотр, откат | files, accounts, transactions, categories, merchants, fx-rates, llm, actions, notifications | user | `statements.imported`, `statements.rolled-back` |
| `receipts` | RCPT-01…15, PRIV-04, SEC-11 | чеки: QR, распознавание, валидатор, перепроверка, дубли, правка, гарантийные позиции | files, transactions, categories, merchants, llm, actions, notifications, explain | user | `receipts.recognized`, `receipts.needs-review`, `receipts.warranty-items-found` |
| `recurring` | REC-01…05 | поиск регулярных, ожидаемые даты, «возможно прекращён», подписки | transactions, categories, profile, notifications | user | `recurring.changed` |
| `legal-base` | LAW-01…40, LEGAL-11, ADM-10 | каталог актов, загрузчик pravo.by, редакции и версии фрагментов, гибридный поиск, журнал спроса, публичная «База законов» | llm, notifications, identity | public, system | `legal-base.act-updated`, `legal-base.act-repealed` |
| `norm-tables` | TAX-03, CAL-02 (сроки), AFF-05 (пределы ПДН), LAW-33, LEGAL-08, ADM-11 | таблицы «параметр → период → значение → источник» с подтверждением человеком | legal-base, notifications | public, system | `norm-tables.values-confirmed` |
| `legal-consult` | LEGAL-01…12, CHAT-05/06, P3 | метки цитат `[[F…]]`, проверка дословности, «в моей базе нет», чек-листы документов и их состояние | legal-base | user | — |
<!-- /capabilities:tier-2 -->

## Ярус 3 — расчёты и представления

<!-- capabilities:tier-3 -->
| id | SPEC | Ответственность | Зависит от | Таблицы | Публикует |
|---|---|---|---|---|---|
| `fin` | FIN-01/20/21/22 | свободный остаток, средний регулярный доход, прогноз остатка по дням | accounts, transactions, recurring, profile, explain | — | — |
| `budgets` | BUD-01…07 | лимиты, цели, копилка, рекомендуемый взнос, пороги уведомлений | accounts, transactions, categories, fin, notifications, actions, explain | user | — |
| `calendar` | CAL-01…08, PROF-07 (вопрос об имуществе) | события, напоминания (таблица `reminders` + тик), сроки налогов, гарантии, страховки | profile, transactions, recurring, receipts, norm-tables, notifications, actions | user | — |
| `tax` | TAX-01…07, TAX-20 | калькулятор вычетов (через `calc`), найденные вычеты по операциям | profile, transactions, categories, norm-tables, legal-base, legal-consult, notifications, explain | user | — |
| `afford` | AFF-01…08 | три сценария покупки, просадки, безопасный платёж по ПДН | accounts, transactions, recurring, fin, budgets, calendar, norm-tables, profile, explain | — | — |
| `weekly` | WEEK-01…03 | итоги недели: числа — `calc`, текст — модель | transactions, budgets, calendar, recurring, tax, llm, notifications, explain | user | — |
| `dashboard` | DASH-01…04 | сборка главного экрана (только чтение, пачками) | accounts, transactions, fin, budgets, recurring, calendar, tax, weekly | — | — |
| `xls-export` | XLS-01…04 | Excel с живыми формулами (без диаграмм, R43) | transactions, categories, budgets, files | — | — |
<!-- /capabilities:tier-3 -->

## Ярус 4 — входы и оркестрация

<!-- capabilities:tier-4 -->
| id | SPEC | Ответственность | Зависит от | Таблицы | Публикует |
|---|---|---|---|---|---|
| `voice` | VOICE-01…03 | речь → текст (облако по согласию, иначе whisper.cpp) | llm | — | — |
| `agent` | AGT-01…14, SEC-10, LLM-10 (выбор в запуске) | цикл агента, реестр инструментов и наборов, подсказки, «вне темы», проверка чисел ответа, постобработка цитат | llm, actions, profile, legal-consult | — | — |
| `chat` | CHAT-01…10 | диалоги, сообщения (`UIMessage.parts`), поток ответа, вложения, контекст страницы, «статья изменилась» | agent, files, receipts, statements, voice, legal-base, legal-consult | user | — |
| `telegram` | TG-01…11, PRIV-08 (подключение), AUTH-05 (сброс через бот) | бот: привязка, команды, фото/файлы/голос, канал доставки уведомлений | chat, agent, identity, privacy, notifications, actions, receipts, statements, voice, dashboard, budgets, weekly | system | — |
| `demo` | DEMO-01…04 | демо-пользователь и связный набор данных от текущей даты (воспроизводимо) | identity, privacy, profile, files, accounts, transactions, receipts, categories, recurring, budgets, calendar, weekly | — | — |
| `quality` | QA-10…16, ADM-40 | eval-прогоны с бюджетом токенов, результаты, сравнение с прошлыми | llm, receipts, statements, categories, legal-base, legal-consult, agent | system | — |
| `admin` | ADM-01…60 (экраны) | раздел «Администрирование»: собирает admin-фасады модулей; своих данных нет | identity, privacy, notifications, mail, llm, legal-base, norm-tables, system, quality, demo | — | — |
<!-- /capabilities:tier-4 -->

## Кто слушает события

| Событие (нагрузка — только id, пачкой) | Слушатели |
|---|---|
| `identity.system-initialized { ids: [userId] }` (администратор) | `legal-base` (стартовый каталог, LAW-10), `llm` (скачивание моделей, NFR-25), `demo` (демо-данные, DEMO-04) |
| `identity.user-registered { ids: [userId] }` (владелец — scope задачи) | `accounts` («Наличные», STMT-01) |
| `identity.user-deleted { ids: [userId] }` | — (удаление идёт синхронно через реестр владельцев данных `privacy`; событие — для журналов) |
| `transactions.changed {ids}` | `budgets` (пороги 80/100 %), `recurring` (пересчёт), `tax` (поиск вычетов), `calendar` (страховки CAL-05) |
| `transactions.merged {receiptId, transactionId}` | `receipts` (перепривязка чека, TXN-10) |
| `accounts.balances-changed {accountIds}` | `budgets` (цели по счёту, BUD-04) |
| `receipts.warranty-items-found {itemIds}` | `calendar` (конец гарантии, CAL-04) |
| `recurring.changed {ids}` | `calendar` (CAL-03) |
| `profile.facts-changed {factIds}` | `tax` (TAX-20), `calendar` (CAL-02) |
| `legal-base.act-updated {actId, fragmentIds}` | `norm-tables` (сверка ставок, LAW-33) |
| `norm-tables.values-confirmed {keys}` | `calendar` (пересчёт сроков налогов) |
| `statements.imported`, `statements.rolled-back` | — (пересчёты идут по `transactions.changed`; уведомление «импорт завершён» — вызов фасада) |

## Порядок сборки по фазам

Каждая фаза заканчивается работающим, проверяемым куском. Фазы и крупные задачи со статусами — `tasks/plan.md`.

| Фаза | Модули | Что работает в конце |
|---|---|---|
| 1 · Бетон | платформа, пакеты, все 36 модулей пустыми (T-007); минимальные версии модулей яруса 1 — `identity` (первый запуск и вход, T-009), `mail`, `privacy`, `notifications`, `files`, `explain`, `actions`, `system` (пустые живые заготовки); `llm` (шлюз с тестовым провайдером), `agent` и `chat` (один инструмент, поток), `accounts` (только `list` и «Наличные» для сквозного среза) | `make check`, сквозной срез «вход → счёт „Наличные“ → сайт → e2e», поток чата на тестовом провайдере (ARCHITECTURE §13) |
| 2 · Операции | в начале фазы — полные версии модулей яруса 1: `identity`, `privacy`, `mail` (T-012, T-013), `actions`, `explain` (T-014), `notifications` (T-015), `files`, `privacy` (T-016), `system` и экраны `admin` (T-017); затем `profile`, `fx-rates`, `merchants`, `categories`, `accounts`, `transactions` | регистрация, вход и восстановление, уведомления, «Мои данные», админка; экран «Операции», ручной ввод, категоризация правилами |
| 3 · Данные без ручного ввода | `llm` (провайдеры, маскирование, локальные модели), `statements`, `receipts` | импорт выписок, чеки по фото, сопоставление |
| 4 · Живой дашборд | `recurring`, `fin`, `budgets`, `dashboard` | дашборд без виджетов фаз 5–7 (вычеты, календарь, итоги недели добавляются в фазе 7) |
| 5 · Правовая база | `legal-base`, `norm-tables`, `legal-consult` | каталог, загрузчик, поиск, «База законов», таблица ставок |
| 6 · Ассистент | `agent`, `chat`, `voice` | чат с инструментами всех готовых модулей, цитаты, голос |
| 7 · Выгода и планирование | `tax`, `calendar`, `afford`, `weekly`, `xls-export` | вычеты, календарь, сценарии покупки, итоги недели, Excel |
| 8 · Каналы, показ, качество | `telegram`, `demo`, `quality` | бот, демо-данные, eval |
| сквозной | `admin` | admin-экран области X делается в задаче модуля X: код экрана — в `admin`/`features/admin`, фасад — в X |

Задача = модуль вместе со своей частью экранов (`docs/ARCHITECTURE.md` §10.5): кусок экрана, зависящий от
модуля, встраивает задача этого модуля; столбец «Модули сервера» ниже — все модули, чьи куски окажутся на экране.

Инструменты агента (`agent/tools.ts`) модуль добавляет в своей задаче, даже если агент ещё не собран:
они проверяются тестом через `defineTool` без модели.

## Экраны сайта (фичи `apps/web/src/features/<id>`)

| Фича | Макет (`design/screens/`) | Маршрут | Модули сервера (контракт) |
|---|---|---|---|
| `dashboard` | `Main`, `MobileHome` | `/` | dashboard, explain, weekly, tax, afford (кнопка) |
| `operations` | `Operations` | `/operations` | transactions, categories, receipts, xls-export |
| `documents` | `Documents`, `MobileScan` | `/documents` | receipts, statements, files |
| `accounts` | `Accounts` | `/accounts` | accounts, fx-rates |
| `recurring` | `Recurring` | `/recurring` | recurring |
| `budget` | `Budget` | `/budget` | budgets |
| `calendar` | `Calendar` | `/calendar` | calendar |
| `assistant` | `Assistant`, `MobileChat` | `/assistant/$dialogId` + панель в каркасе | chat, voice, llm (выбор модели) |
| `deductions` | `Deductions` | `/deductions` | tax, legal-consult |
| `afford` | `Afford` | `/afford` | afford |
| `laws` | `Laws` | `/laws` (публичная) | legal-base |
| `memory` | `Memory` | `/memory` | profile |
| `auth` | `Login`, `Register` | `/login`, `/register`, `/recovery`, `/policy` | identity, privacy |
| `onboarding` | `Onboarding` | `/onboarding` | profile |
| `setup` | `Setup` | `/setup` (только localhost) | identity |
| `mailbox` | `Mailbox` | `/mailbox` (только localhost) | mail |
| `settings` | `Settings` | `/settings` | identity, privacy, notifications, telegram, llm |
| `notifications` | состояние `Main--notifications` | колокольчик в каркасе | notifications, actions |
| `admin/<раздел>` | `Admin` + состояния `Admin--*` | `/admin/{users,laws,rates,ai,quality,system}` | admin |

Экран `Telegram.dc.html` — это бот (модуль `telegram`), а не страница сайта.
