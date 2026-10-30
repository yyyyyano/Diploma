# Модуль `legal-base`

Ярус 2 · таблицы: public, system · публикует: `legal-base.act-updated`, `legal-base.act-repealed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Каталог актов, вежливый загрузчик pravo.by, снимки и фрагменты, карантин (T-034); поиск и векторы (T-035); редакции (T-036);
версии, карточки, события (T-036); пополнение каталога (T-037); «База законов» (T-038).

## Требования SPEC
LAW-01…40, LEGAL-11, ADM-10; сделано: LAW-01, 03, 04, 07, 08 (поиск), 10, 20…23, 30…34, 35…39, AUTH-10.

## Публичный API (`index.ts`)
- Фабрика: `createLegalBaseModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `llm` (эмбеддинги, локальная
  модель), `notifications` (`notifyAdmins`), `identity` (`loaderContact()`).
- Инструменты агента (набор `legal`, чтение): `search_law`, `get_law_fragment`, `law_act_card`. Фасад: `search(query, opts?)` → `{ mode: exact | hybrid, vectors, fragments[] }` (6–10 действующих фрагментов со ссылкой),
  `fragment(versionId)`, `actCard(pravoId)`, `vectorProgress(modelReady)` (для админки, T-039).
- Поиск: 1) точное обращение «ст. 210 НК», «п. 3 ст. 13 Закона о …» по таблице кратких имён `legal_act_aliases` (у «НК» два акта —
  берётся тот, где есть статья); 2) гибрид: FTS `russian` (ё→е, сначала «И», при нехватке «ИЛИ») + halfvec HNSW, RRF k = 60,
  словарь «бытовое → юридическое»; только действующие акты и версии; 3) расширение статьями по ссылкам и определениями.
  Без модели эмбеддингов — реквизиты и FTS, ключ лога `law.search.no-vectors`.
- Векторы: задача `legal-base.embed` (порции, прогресс) для версий без вектора активной модели (`legal_embedding_models`:
  имя и версия); нет модели — «ждём модель», без повторов; смена модели — переиндексация.
- Редакции (LAW-31): страница изменилась без признаков поломки → `matchVersions` (путь и текст: продлить / новая версия /
  перенумерация по тексту / добавлен / «исключён»); закрытая версия теряет вектор, `embed` векторизует только новые.
- Расписание `legal-base.daily-check` (04:00 статично, `missed: once`; время и окно — T-039): текст — HEAD без сжатия (размер как у
  снимка — не качаем), иначе загрузка и сверка; карточка (`guid=3961`) индекса — ежедневно, прочих актов — раз в неделю: утрата
  силы («Дата ограничения действия», LAW-34 → статус, выход из поиска) и изменяющие акты вне текста (LAW-32,
  `legal_pending_changes`): модель (`systemCaller`, `law.topic`, `law-change-v1`) предлагает статьи и дату, принимается только
  дословно найденное в тексте изменяющего акта; без текста — уровень акта; 7 дней без изменений — уведомление админу.
- События `legal-base.act-updated` / `act-repealed` (id актов пачкой) — системные, без владельца: публикуются от имени первого
  администратора через `identity.adminScoped()` (как `identity.system-initialized`, обратимо); `facade.pendingChanges(pravoId)`.
- Догрузка по требованию (LAW-09): `search(query, { s })` по названному акту без индекса ставит задачу `legal-base.load-act`
  (приоритет; `api` в сеть не ходит), ждёт до `legal-base.demand-wait-ms` (15 с), ответ с `justAdded`; не дождался или предел
  `legal-base.demand-limit-per-day` (20) — `cards` со ссылкой, на пределе уведомление админу.
- HNSW построен под первую модель (bge-m3 v1); при смене модели нужный частичный индекс добавляется миграцией.
- Подписка на `identity.system-initialized`: контакт → настройка `legal-base.loader-contact`; 28 актов заводятся сразу; при
  `legal-base.autoload` — задача `legal-base.load-start-catalog` (по одному акту; остановка/ошибка — `UNAVAILABLE`, повтор
  через 30 минут), после неё — `legal-base.embed`.
- Настройки (`legal-base.*`): `autoload`, `source` (`pravo-by` | `fixtures`), `fixtures-dir`, `base-url`, `loader-contact`,
  `pause-min-ms`/`pause-max-ms`, `timeout-ms`, `max-page-bytes`, `demand-*`.
- Таблицы (`publicTable`): `legal_acts`, `legal_act_snapshots` (gzip, `applied|quarantined|pending`), `legal_fragments` (ключ
  `a216.1/p3`), `legal_fragment_versions` (+ `search_tsv`, GIN по текущим), `legal_act_aliases`, `legal_embedding_models`,
  `legal_fragment_embeddings` (HNSW по первой модели), `legal_pending_changes`, `legal_demand_loads`; `systemTable` — `legal_loader_state`, `legal_fetch_log`, `legal_update_log`.

## Устройство
- `domain/` (чистое): фрагменты, карантин, версии, обращения, алиасы, словарь, `ts-query`, `change-proposal`; `infrastructure/pravo-by/`:
  `polite-fetcher` (слоты в БД, robots, повторы, GET/HEAD), источники `pravo-source`/`fixtures-source`, `cheerio` (страница, карточка).
- `application/`: `load-act`, `act-check`, `daily-check`, `start-catalog`, `search`, `demand`, `embed`, `lookup`; SQL — `*.repo.ts`.

## Зависимости
Можно: llm, notifications, identity (`tooling/architecture/modules.ts`). Слушает: `identity.system-initialized`.

## Запреты
- В чужой модуль — только через `index.ts` из «Можно»; `SystemDb` — только свои таблицы.
- Запросы к pravo.by — только через `PoliteFetcher` (robots, пауза); тесты и стенд e2e — `legal-base.source = fixtures`.
- Карантин оставляет прежнюю редакцию, ничего не удаляется. Контакт оператора — только в настройке и User-Agent.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/legal-base` (unit и int); первый запуск — `main/legal-base-startup.int.test.ts`; `make bench` —
  бюджеты поиска (поддельные векторы). Страницы — `__fixtures__/pravo-by/`: настоящие, 2026-10-30 (адрес и дата в первой строке).
