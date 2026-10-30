# Модуль `legal-base`

Ярус 2 · таблицы: public, system · публикует: `legal-base.act-updated`, `legal-base.act-repealed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Каталог актов, вежливый загрузчик pravo.by, снимки и фрагменты, карантин (T-034); поиск и векторы (T-035); редакции (T-036);
ежедневная проверка и версии (T-036); пополнение каталога (T-037); «База законов» (T-038).

## Требования SPEC
LAW-01…40, LEGAL-11, ADM-10; сделано: LAW-01, 03, 04, 07, 08 (поиск), 10, 20…23, 30 (часть), 31, 35…39, AUTH-10.

## Публичный API (`index.ts`)
- Фабрика: `createLegalBaseModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `llm` (эмбеддинги, локальная
  модель), `notifications` (`notifyAdmins`), `identity` (`loaderContact()`).
- Фасад: `search(query, limit?)` → `{ mode: exact | hybrid, vectors, fragments[] }` (6–10 действующих фрагментов со ссылкой),
  `fragment(versionId)`, `actCard(pravoId)`, `vectorProgress(modelReady)` (для админки, T-039).
- Инструменты агента (набор `legal`, чтение): `search_law`, `get_law_fragment`, `law_act_card`.
- Поиск: 1) точное обращение «ст. 210 НК», «п. 3 ст. 13 Закона о …» по таблице кратких имён `legal_act_aliases` (у «НК» два акта —
  берётся тот, где есть статья); 2) гибрид: FTS `russian` (ё→е, сначала «И», при нехватке «ИЛИ») + halfvec HNSW, RRF k = 60,
  словарь «бытовое → юридическое»; только действующие акты и версии; 3) расширение статьями по ссылкам и определениями.
  Без модели эмбеддингов — реквизиты и FTS, ключ лога `law.search.no-vectors`.
- Векторы: задача `legal-base.embed` (порции, прогресс) для действующих версий без вектора активной модели
  (`legal_embedding_models`: имя и версия); нет модели — «ждём модель», без повторов; смена модели — переиндексация.
- Редакции (LAW-31): страница изменилась без признаков поломки → `matchVersions` (путь и текст: продлить / новая версия /
  перенумерация по тексту / добавлен / «исключён»); закрытая версия теряет вектор, `embed` векторизует только новые.
  Расписание `legal-base.daily-check` (04:00, `missed: once`): все загруженные акты; остановка загрузчика — `law-update-failed`.
- Контракт `legalBase.startupProgress` (localOnly): «Загружено N из 28» на экране первого запуска.
- Подписка на `identity.system-initialized`: контакт → настройка `legal-base.loader-contact`; 28 актов заводятся сразу; при
  `legal-base.autoload` — задача `legal-base.load-start-catalog` (по одному акту; остановка/ошибка — `UNAVAILABLE`, повтор
  через 30 минут), после неё — `legal-base.embed`.
- Настройки (`legal-base.*`): `autoload`, `source` (`pravo-by` | `fixtures`), `fixtures-dir`, `base-url`, `loader-contact`,
  `pause-min-ms`/`pause-max-ms` (3–5 с), `timeout-ms`, `max-page-bytes`.
- Таблицы: `publicTable` — `legal_acts`, `legal_act_snapshots` (gzip, `applied|quarantined|pending`), `legal_fragments` (ключ
  `a216.1/p3`), `legal_fragment_versions` (+ `search_tsv`, GIN по текущим), `legal_act_aliases`, `legal_embedding_models`,
  `legal_fragment_embeddings` (HNSW по первой модели); `systemTable` — `legal_loader_state`, `legal_fetch_log`, `legal_update_log`.

## Устройство
- `domain/`: `build-fragments` (LAW-20), `quarantine` (LAW-39, канарейка 90-З — 51 статья), `match-versions`, `start-catalog`, `reference`
  (разбор обращения), `aliases`, `synonyms`, `ts-query`. `infrastructure/pravo-by/`: `polite-fetcher` (слоты в БД под
  advisory-lock, robots, лесенка повторов, остановка до следующих суток), источники `pravo-source` и `fixtures-source`, `cheerio`.
- `application/`: `load-act`, `start-catalog`, `search`, `embed`, `lookup`; `infrastructure/db/*.repo.ts` — SQL.

## Зависимости
Можно: llm, notifications, identity (`tooling/architecture/modules.ts`). Слушает: `identity.system-initialized`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; `SystemDb` — только свои таблицы system/public.
- Запросы к pravo.by — только через `PoliteFetcher` (robots, пауза); тесты и стенд e2e — `legal-base.source = fixtures`.
- Ничего не удаляется автоматически: карантин оставляет прежнюю редакцию. Контакт оператора — только в настройке и User-Agent.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/legal-base` (unit и int на Postgres); сквозной первый запуск —
  `main/legal-base-startup.int.test.ts`; `make bench` — бюджеты поиска (`application/search.bench.ts`, поддельные векторы).
- Страницы — `__fixtures__/pravo-by/`: настоящие, сохранены 2026-10-30 (адрес и дата в первой строке); форматер их не трогает.
