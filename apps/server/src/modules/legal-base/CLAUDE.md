# Модуль `legal-base`

Ярус 2 · таблицы: public, system · публикует: `legal-base.act-updated`, `legal-base.act-repealed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Каталог актов, вежливый загрузчик pravo.by, снимки и фрагменты, карантин (T-034); поиск и векторы (T-035); редакции, версии, карточки,
события (T-036); пополнение каталога (T-037); «База законов» (T-038).

## Требования SPEC
LAW-01…40, LEGAL-11, ADM-10; сделано: LAW-01…04, 07, 08 (поиск), 10…15, 17, 20…23, 30…34, 35…39, AUTH-10.

## Публичный API (`index.ts`)
- Фабрика: `createLegalBaseModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `llm` (эмбеддинги, локальная модель, `law.topic`),
  `notifications` (`notifyAdmins`), `identity` (`loaderContact()`, `adminScoped()`). Типы: `Topic`, `TOPICS` (10 тем LAW-01).
- Инструменты агента (набор `legal`, чтение): `search_law`, `get_law_fragment`, `law_act_card`. Фасад: `search(query, opts?)` → `{ mode: exact | hybrid,
  vectors, fragments[] }` (6–10 действующих фрагментов), `fragment(versionId)`, `actCard(pravoId)`, `vectorProgress(modelReady)`, `pendingChanges(pravoId)`,
  `recordDemand({ topic, actIds })` — журнал спроса: тема из `TOPICS`, ≤ 20 ID актов, без текста вопроса (иначе `VALIDATION`). Публичные процедуры
  (`publicProc`, T-038): `catalog`, `act`, `fragments`, `resolve` (`application/reader.ts`: оглавление — статьи или страницы по 40 фрагментов; тексты частями).
- Поиск: 1) «ст. 210 НК», «п. 3 ст. 13 Закона о …» по кратким именам `legal_act_aliases` (у «НК» два акта — где есть статья); 2) гибрид: FTS `russian`
  (ё→е, «И», при нехватке «ИЛИ») + halfvec HNSW, RRF k = 60, словарь «бытовое → юридическое», только действующее; 3) расширение статьями по ссылкам
  и определениям. Без модели — реквизиты и FTS (`law.search.no-vectors`). Догрузка по требованию (LAW-09): акт без индекса — задача `load-act`
  (`api` в сеть не ходит), ждёт `demand-wait-ms` (15 с), ответ с `justAdded`; не дождался или предел `demand-limit-per-day` (20) — `cards`.
- Векторы: `legal-base.embed` для версий без вектора активной модели (нет модели — «ждём модель»; HNSW под bge-m3 v1, смена модели — миграцией). Редакции (LAW-31): `matchVersions`.
- `legal-base.daily-check` (04:00, `missed: once`; время и окно — T-039): текст — HEAD без сжатия (размер совпал — не качаем), иначе загрузка и сверка;
  карточка (`guid=3961`) индекса — ежедневно, прочих — раз в неделю: утрата силы (LAW-34) и изменяющие акты вне текста (LAW-32, `legal_pending_changes`:
  модель `law-change-v1` предлагает, принимается дословно найденное; без текста — уровень акта; 7 дней — уведомление). События `act-updated` /
  `act-repealed` (id пачкой) — от имени первого администратора через `identity.adminScoped()`.
- Пополнение каталога (T-037), `legal-base.catalog-growth` (04:30): найденное — кандидаты `legal_candidates` (`found → queued | rejected | dropped | added |
  event`). Находки: граф ссылок на 1 шаг (`requisitesIn` по текстам без перечня `changeadd`; ID: закон H1/V1, указ P3, ПСМ C2, кодекс HK/Hk, ведомственные не
  разрешаются), «Новые поступления» с отметки `arrivals-day` по вчера (≤ 30 дней; число актов на странице — канарейка вёрстки), ведомственные страницы
  раз в месяц (`agency-pages`, пусто по умолчанию), журнал спроса (недельная сводка: акты без индекса — в очередь). Кандидат: LAW-13 без модели (местные
  `D9`/`R9`, раздел реестра ≥ 15, шаблоны заголовков; изменяющий акт — внеплановая проверка изменяемых через `actCheck`, не запись каталога) → карточка →
  HEAD текста → тема (ЕПК `guid=11031` у актов с текстом, заголовок и орган у актов без текста; модель `law-topic-v1` — только когда ничего не решило) →
  маршрут LAW-17 (`domain/routes.ts`, `new-acts-mode` auto|suggest). Причина отсева — `legal_update_log` (`candidate-dropped`); за проход ≤ `growth-batch`
  проверок с запросами; текст нового акта без текста — раз в неделю `text-check-weeks` (8) недель.
- Подписка на `identity.system-initialized`: контакт → `loader-contact`; 28 актов — сразу; при `autoload` — `load-start-catalog` (повтор через 30 минут), затем `embed`.
- Настройки (`legal-base.*`): `autoload`, `source` (`pravo-by`|`fixtures`), `fixtures-dir`, `base-url`, `loader-contact`, `pause-*-ms`, `timeout-ms`,
  `max-page-bytes`, `demand-*`, `new-acts-mode`, `growth-batch`, `text-check-weeks`, `filter-title-patterns`, `epk-topics`, `agency-pages`.
- Таблицы (`publicTable`): `legal_acts` (+ `topic`, `topic_source`), `legal_act_snapshots` (gzip), `legal_fragments` (ключ `a216.1/p3`), `legal_fragment_versions`
  (+ `search_tsv`), `legal_act_aliases`, `legal_embedding_models`, `legal_fragment_embeddings`, `legal_pending_changes`, `legal_demand_loads`; `systemTable` —
  `legal_loader_state` (строка на хост), `legal_fetch_log`, `legal_update_log`, `legal_candidates`, `legal_demand_log`, `legal_growth_marks`.

## Устройство
- `domain/` (чистое): фрагменты, карантин, версии, обращения, алиасы, словарь, `ts-query`, `change-proposal`, `requisites`, `relevance`, `topics`, `routes`;
  `infrastructure/pravo-by/`: `polite-fetcher` (слоты в БД, robots, повторы, GET/HEAD; экземпляр и строка состояния на каждый хост), источники
  `pravo-source`/`fixtures-source`/`createAgencySource`, `cheerio` (страница, карточка, новые поступления, рубрики ЕПК, ссылки ведомств).
- `application/`: `load-act`, `act-check`, `daily-check`, `start-catalog`, `search`, `demand`, `embed`, `lookup`, `catalog-growth`; SQL — `*.repo.ts`.

Можно: llm, notifications, identity (`tooling/architecture/modules.ts`). Слушает: `identity.system-initialized`.

## Запреты
- В чужой модуль — только через `index.ts` из «Можно»; `SystemDb` — только свои таблицы. Запросы к сайтам — только через `PoliteFetcher` (robots, пауза);
  тесты и стенд e2e — `legal-base.source = fixtures`.
- Ведомственные сайты — только ссылки на pravo.by, текст с них не берётся (LAW-03); у каждого хоста своя пауза и robots. Рубрики ЕПК (`guid=11031`) на живой
  странице 90-З лежат в HTML-комментарии: разбор читает и его; уберёт сайт блок — акты с текстом пойдут в очередь (LAW-14).
- Карантин оставляет прежнюю редакцию, ничего не удаляется. Контакт оператора — только в настройке и User-Agent.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/legal-base` (unit и int); первый запуск — `main/legal-base-startup.int.test.ts`; `make bench` — бюджеты поиска
  (поддельные векторы). Страницы — `__fixtures__/pravo-by/`: настоящие, 2026-10-30 (адрес и дата в первой строке).
