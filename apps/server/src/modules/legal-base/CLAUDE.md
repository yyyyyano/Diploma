# Модуль `legal-base`

Ярус 2 · таблицы: public, system · публикует: `legal-base.act-updated`, `legal-base.act-repealed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Каталог актов, вежливый загрузчик pravo.by, снимки и фрагменты, карантин (T-034); поиск и векторы (T-035); редакции, версии, карточки,
события (T-036); пополнение каталога (T-037); «База законов» (T-038); вкладка «Законы» админки (T-039).

## Требования SPEC
LAW-01…40, LEGAL-11, ADM-10; сделано: LAW-01…04, 06, 07, 08 (поиск), 10…17, 20…23, 30…40, AUTH-10, ADM-10.

## Публичный API (`index.ts`)
- Фабрика: `createLegalBaseModule({ platform, facades })` (`SystemPlatform`; фасады `llm`, `notifications`, `identity`: `loaderContact()`, `adminScoped()`). Типы: `Topic`, `TOPICS`.
- Инструменты агента (набор `legal`, чтение): `search_law`, `get_law_fragment`, `law_act_card`. Фасад: `search(query, opts?)` → `{ mode, vectors, fragments[] }`, `fragment(versionId)`,
  `actCard(pravoId)`, `citations(versionIds)` (T-041: любые версии по id — текст, путь, действующая ли, `editionOn`, состояние акта; цитаты `legal-consult`), `firstEditionOn(pravoId)` (LEGAL-08), `fragmentsUnder(pravoId, pathKey)` (пункт и вложенные части — сверка ставок LAW-33), `vectorProgress(modelReady)`, `pendingChanges(pravoId)`, `recordDemand({ topic, actIds })` (тема из `TOPICS`, ≤ 20 ID, без текста вопроса, иначе `VALIDATION`).
  Публичные процедуры (`publicProc`, T-038): `catalog`, `act`, `fragments`, `resolve` (`reader.ts`: оглавление — статьи или страницы по 40 фрагментов).
- Поиск: 1) «ст. 210 НК» по кратким именам `legal_act_aliases` (у «НК» два акта — где есть статья); 2) гибрид: FTS `russian` + halfvec HNSW, RRF k = 60, словарь «бытовое →
  юридическое» из таблицы, только действующее; 3) расширение статьями по ссылкам. Без модели — реквизиты и FTS. Догрузка по требованию (LAW-09): задача `load-act`
  (`api` в сеть не ходит), ждёт `demand-wait-ms`, ответ с `justAdded`; не дождался или предел `demand-limit-per-day` — `cards`.
- Векторы: `legal-base.embed` для версий без вектора активной модели (нет модели — «ждём модель»; HNSW под bge-m3 v1, смена модели — миграцией). Редакции (LAW-31): `matchVersions`.
- `legal-base.daily-check` (время `check-time`, 04:00; `liveCron` — смена без перезапуска; `missed: once`; итог — строка `daily-check`/`daily-check-failed` в `legal_update_log`;
  `auto-update` выключен — плановый проход пуст): текст — HEAD (размер совпал — не качаем), иначе загрузка и сверка; карточка (`guid=3961`) индекса — ежедневно, прочих —
  раз в неделю: утрата силы (LAW-34), изменяющие акты вне текста (LAW-32: модель `law-change-v1` предлагает, принимается дословно найденное; 7 дней — уведомление).
  События `act-updated`/`act-repealed` — от имени первого администратора через `identity.adminScoped()`.
- Пополнение каталога (T-037), `legal-base.catalog-growth` (через 30 минут после проверки, тот же `liveCron`): кандидаты `legal_candidates` (`found → queued | rejected | dropped |
  added | event`). Находки: граф ссылок на 1 шаг, «Новые поступления» с отметки `arrivals-day` (≤ 30 дней; число актов — канарейка вёрстки), ведомственные страницы раз в
  месяц (`agency-pages`, пусто по умолчанию), журнал спроса. Кандидат: LAW-13 без модели → карточка → HEAD текста → тема (ЕПК у актов с текстом, заголовок и орган у
  актов без текста; модель `law-topic-v1` — только когда ничего не решило) → маршрут LAW-17 (`routes.ts`, `new-acts-mode`). Причина отсева — `legal_update_log`; за проход
  ≤ `growth-batch` проверок с запросами; текст нового акта без текста — раз в неделю `text-check-weeks` недель. Уведомление `law-new-acts` — ключ «день + число актов за сутки»: повторный проход без новых актов молчит, второй проход того же дня с новыми — новое.
- Вкладка «Законы» (T-039, LAW-40): фасад `admin` (`laws-admin.ts`; `s` — администратор, роль проверяет `admin`): сводка, «N из 28», векторы, расписание и контакт
  (`overview`), список актов в 7 состояниях (`admin-status.ts`), журналы, очередь `decide`, `setSettings` (время проверки — только в ночном окне с запасом на проход
  пополнения, иначе `VALIDATION` с полем), `exclude` (статус `excluded`: не в каталоге, поиске и проверках; записи остаются), `addActs` (ссылки pravo.by). Сеть — задачами
  worker под `s` администратора: `check-now` (весь проход или текст одного акта) и `add-acts` (`growth.addManual` без фильтров LAW-13; местные акты — LAW-06).
- Справочники (LAW-40): одна тройка `list/upsert/remove(kind)` на семь видов (`dictionaries.ts`, поля — `domain/dictionaries.ts`): `start-catalog`, `organs`, `colloquial` — таблицы
  (умолчания кода кладёт миграция, сверяет `dictionaries.repo.int.test.ts`), `aliases` — `legal_act_aliases`, `epk-topics`, `title-patterns`, `agency-pages` — настройки.
- Подписка на `identity.system-initialized`: контакт → `loader-contact`; 28 актов — сразу; при `autoload` — `load-start-catalog` (повтор через 30 минут), затем `embed`.
- Настройки (`legal-base.*`): `autoload`, `source`, `fixtures-dir`, `base-url`, `loader-contact`, `pause-*-ms`, `timeout-ms`, `max-page-bytes`, `demand-*`, `new-acts-mode`,
  `auto-update`, `check-time`, `window-from`/`window-to`, `growth-batch`, `text-check-weeks`, `filter-title-patterns`, `epk-topics`, `agency-pages`.
- Таблицы (`publicTable`): `legal_acts` (статус `active|repealed|excluded`), `legal_act_snapshots`, `legal_fragments`, `legal_fragment_versions`, `legal_act_aliases`, `legal_embedding_models`,
  `legal_fragment_embeddings`, `legal_pending_changes`, `legal_demand_loads`; `systemTable` — `legal_loader_state`, `legal_fetch_log`, `legal_update_log`, `legal_candidates`,
  `legal_demand_log`, `legal_growth_marks`, `legal_start_catalog`, `legal_organ_topics`, `legal_colloquial_terms`.

## Устройство
- `domain/` (чистое): фрагменты, карантин, версии, алиасы, `ts-query`, `change-proposal`, `requisites`, `relevance`, `topics`, `routes`, `schedule`, `act-links`, `admin-status`,
  `dictionaries`; `infrastructure/pravo-by/`: `polite-fetcher` (аренда очереди в БД — один запрос за раз для всех задач, пауза от конца запроса; robots, повторы; состояние на каждый хост), источники `pravo-source`/`fixtures-source`/
  `createAgencySource`, `cheerio`-разборщики. `application/`: `load-act`, `act-check`, `daily-check`, `start-catalog`, `search`, `demand`, `embed`, `lookup`, `catalog-growth`, `add-acts`,
  `laws-admin`, `dictionaries`; SQL — `*.repo.ts`.

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
