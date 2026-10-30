# Модуль `legal-base`

Ярус 2 · таблицы: public, system · публикует: `legal-base.act-updated`, `legal-base.act-repealed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Каталог актов, вежливый загрузчик pravo.by, снимки и фрагменты, карантин (T-034); поиск и векторы (T-035); редакции (T-036);
версии, карточки, события (T-036); пополнение каталога (T-037); «База законов» (T-038).

## Требования SPEC
LAW-01…40, LEGAL-11, ADM-10; сделано: LAW-01…04, 07, 08 (поиск), 10…15, 17, 20…23, 30…34, 35…39, AUTH-10.

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
- Пополнение каталога (T-037), расписание `legal-base.catalog-growth` (04:30, после ежедневной проверки): всё найденное — кандидаты
  `legal_candidates` (`found → queued | rejected | dropped | added | event`). Находки: граф ссылок на 1 шаг (`requisitesIn` по текстам
  загруженных актов без перечня `changeadd`, ID по правилу реквизитов: закон H1/V1, указ P3, ПСМ C2, кодекс HK/Hk; ведомственные не
  разрешаются), «Новые поступления» за все дни с отметки `arrivals-day` по вчера (≤ 30, первый проход — только вчера; число актов на
  странице — канарейка вёрстки), ведомственные страницы раз в месяц (`legal-base.agency-pages`, по умолчанию пусто; ссылки на pravo.by →
  очередь), журнал спроса. Проверка кандидата (`catalog-growth.ts`): LAW-13 без модели — местные (`D9`/`R9`, раздел реестра ≥ 15),
  шаблоны заголовков (`legal-base.filter-title-patterns`), изменяющий акт («Об изменении…») → не запись каталога, а внеплановая проверка
  изменяемых актов (`actCheck`); карточка (статус, орган) → HEAD текста → тема: рубрики ЕПК `guid=11031` (`legal-base.epk-topics`) для актов
  с текстом, заголовок и орган для актов без текста; модель (`law.topic`, `law-topic-v1`, `systemCaller`) — только когда ничего не решило.
  Маршрут — таблица LAW-17 (`domain/routes.ts`): индекс / карточка / очередь / отсев; `legal-base.new-acts-mode` (`auto` | `suggest`).
  Причина каждого отсева — `legal_update_log` (`candidate-dropped`). За проход — не больше `legal-base.growth-batch` проверок с запросами.
  У нового акта без текста текст проверяется раз в неделю `legal-base.text-check-weeks` (8) недель.
- Журнал спроса: фасад `recordDemand({ topic, actIds })` — тема из `TOPICS` и ID актов (≤ 20), без текста вопроса (`VALIDATION` иначе);
  сводка раз в неделю → акты каталога без индекса в очередь (`legal_demand_log`).
- HNSW построен под первую модель (bge-m3 v1); при смене модели нужный частичный индекс добавляется миграцией.
- Подписка на `identity.system-initialized`: контакт → настройка `legal-base.loader-contact`; 28 актов заводятся сразу; при
  `legal-base.autoload` — задача `legal-base.load-start-catalog` (по одному акту; остановка/ошибка — `UNAVAILABLE`, повтор
  через 30 минут), после неё — `legal-base.embed`.
- Настройки (`legal-base.*`): `autoload`, `source` (`pravo-by` | `fixtures`), `fixtures-dir`, `base-url`, `loader-contact`,
  `pause-min-ms`/`pause-max-ms`, `timeout-ms`, `max-page-bytes`, `demand-*`, `new-acts-mode`, `growth-batch`, `text-check-weeks`, `filter-title-patterns`,
  `epk-topics`, `agency-pages`.
- Таблицы (`publicTable`): `legal_acts`, `legal_act_snapshots` (gzip, `applied|quarantined|pending`), `legal_fragments` (ключ
  `a216.1/p3`), `legal_fragment_versions` (+ `search_tsv`, GIN по текущим), `legal_act_aliases`, `legal_embedding_models`,
  `legal_fragment_embeddings` (HNSW по первой модели), `legal_pending_changes`, `legal_demand_loads`; `systemTable` — `legal_loader_state` (строка на хост), `legal_fetch_log`, `legal_update_log`,
  `legal_candidates`, `legal_demand_log`, `legal_growth_marks`. У `legal_acts` — `topic`, `topic_source`, граф и проверка текста.

## Устройство
- `domain/` (чистое): фрагменты, карантин, версии, обращения, алиасы, словарь, `ts-query`, `change-proposal`; `infrastructure/pravo-by/`:
  `polite-fetcher` (слоты в БД, robots, повторы, GET/HEAD; свой экземпляр и своя строка `legal_loader_state` на каждый хост), источники
  `pravo-source`/`fixtures-source`/`createAgencySource`, `cheerio` (страница, карточка, новые поступления, рубрики ЕПК, ссылки ведомств).
- `application/`: `load-act`, `act-check`, `daily-check`, `start-catalog`, `search`, `demand`, `embed`, `lookup`, `catalog-growth`; SQL — `*.repo.ts`.

## Зависимости
Можно: llm, notifications, identity (`tooling/architecture/modules.ts`). Слушает: `identity.system-initialized`.

## Запреты
- В чужой модуль — только через `index.ts` из «Можно»; `SystemDb` — только свои таблицы.
- Запросы к pravo.by — только через `PoliteFetcher` (robots, пауза); тесты и стенд e2e — `legal-base.source = fixtures`.
- Ведомственные сайты — только ссылки на pravo.by, текст с них не берётся (LAW-03); у каждого хоста своя пауза и robots.
- Страница рубрик ЕПК (`guid=11031`) в фикстурах не сохранена: её разбор проверен на описанной вёрстке, живую проверит первый запуск.
- Карантин оставляет прежнюю редакцию, ничего не удаляется. Контакт оператора — только в настройке и User-Agent.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/legal-base` (unit и int); первый запуск — `main/legal-base-startup.int.test.ts`; `make bench` —
  бюджеты поиска (поддельные векторы). Страницы — `__fixtures__/pravo-by/`: настоящие, 2026-10-30 (адрес и дата в первой строке).
