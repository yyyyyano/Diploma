# Модуль `legal-base`

Ярус 2 · таблицы: public, system · публикует: `legal-base.act-updated`, `legal-base.act-repealed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Каталог актов, вежливый загрузчик pravo.by, снимки и фрагменты, карантин (T-034); дальше — поиск (T-035), редакции (T-036),
пополнение каталога (T-037), «База законов» (T-038).

## Требования SPEC
LAW-01…40, LEGAL-11, ADM-10; сделано: LAW-01, 03, 04, 07, 10, 20, 35…39, AUTH-10.
## Публичный API (`index.ts`)
- Фабрика: `createLegalBaseModule({ platform, facades })`; платформа — `SystemPlatform` (с `system: SystemDb`); фасады —
  `facades.llm` (T-037), `facades.notifications` (`notifyAdmins`), `facades.identity` (`loaderContact()`).
- Контракт `legalBase.startupProgress` (localOnly): `{ state: off | waiting | loading | ready | stopped, done, total,
  problems, stopReason }` — «Загружено 14 из 28 актов» на экране первого запуска.
- Подписка на `identity.system-initialized`: контакт с первого запуска (фасад identity, в событии его нет) → настройка
  `legal-base.loader-contact` (если пуста); 28 актов заводятся сразу (5 карточек — «загружены»); при `legal-base.autoload`
  ставится задача `legal-base.load-start-catalog` (worker, одна очередь): акты по одному, акт с ошибкой — `failed`,
  остановка загрузчика — уведомление `law-update-failed`; оба случая — `UNAVAILABLE`: повтор через 30 минут с места остановки.
- Фасад (T-035) и события `act-updated`, `act-repealed` (T-036) — пока нет.
- Настройки (`settings.ts`): `autoload`, `source` (`pravo-by` | `fixtures`), `fixtures-dir`, `base-url`, `loader-contact`,
  `pause-min-ms` / `pause-max-ms` (3–5 с), `timeout-ms`, `max-page-bytes` (4 МБ; НК ≈ 1,1 МБ) — все с префиксом `legal-base.`.
- Таблицы: `publicTable` — `legal_acts` (каталог; `load_state`: pending | loaded | card-only | quarantined | failed),
  `legal_act_snapshots` (сырой HTML gzip `bytea`; `status`: applied | quarantined | pending; уникален `(акт, хэш)`),
  `legal_fragments` (ключ пути `a216.1/p3/s2`, номер статьи `216.1`), `legal_fragment_versions` (текст, путь для поиска,
  вид, `excluded`, `is_current`); `systemTable` — `legal_loader_state` (одна строка: очередь слотов, остановка на день,
  кэш robots.txt, счётчики цикла), `legal_fetch_log` (журнал запросов), `legal_update_log` (журнал обновлений).

## Устройство
- `domain/`: `build-fragments.ts` (абзацы → фрагменты по LAW-20: короткая статья целиком, длинная — по пунктам и
  подпунктам, указы — по пунктам, надстрочные номера, «исключена», определения / вступление / переходные / приложения),
  `quarantine.ts` (LAW-39: нет шапки, нет статей, сломана кодировка, пропало > 5 %, канарейка Закона № 90-З — 51 статья),
  `start-catalog.ts` (SPEC §6.19.1: 28 актов, 23 текстом, 5 карточкой).
- `infrastructure/pravo-by/`: `polite-fetcher.ts` (один поток; пауза 3–5 с через слоты в БД под `pg_advisory_xact_lock` —
  общая для процессов, переживает перезапуск; сжатие; честный User-Agent с контактом; robots.txt раз в сутки в БД и проверка
  каждого адреса `robots-parser`; лесенка 30 с / 2 мин / 10 мин; 403/429 или > 20 % ошибок за день — остановка до
  следующих суток; пустой контакт — `LOADER_CONTACT_EMPTY`), `pravo-source.ts` (`guid=3871&p0=<ID>`), `fixtures-source.ts`
  (страницы из папки; `ENOENT` = 404), `read-page.ts` + `parse-act.ts` (cheerio).
- `application/`: `load-act.ts` (страница → хэш → разбор → карантин или снимок; изменённая нормальная страница сохраняется
  `pending` — версии сопоставит T-036), `start-catalog.ts` (заведение, цикл, прогресс).

## Зависимости
Можно: llm, notifications, identity (`tooling/architecture/modules.ts`). Слушает: `identity.system-initialized`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.
- Запросы к pravo.by — только через `PoliteFetcher`; `fetch` к сайту в обход него, PDF `/upload/docs/op/`, поиск и
  выдачи автоматически не запрашиваются (robots, LAW-37). Тесты и стенд e2e — только `legal-base.source = fixtures`.
- Ничего не удаляется автоматически: карантин оставляет прежнюю редакцию (LAW-39). Контакт оператора — только в настройке и
  в User-Agent: в лог, журнал, события и уведомления не попадает.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/legal-base` — unit (фрагменты, карантин, каталог, загрузчик на поддельном
  `fetch` и `FakeClock`, разбор сохранённых страниц) и int на Postgres (очередь слотов, загрузка акта, стартовый каталог);
  сквозной первый запуск с worker — `apps/server/src/main/legal-base-startup.int.test.ts`; общий — `make check`.
- Страницы — `__fixtures__/pravo-by/`: настоящие, сохранены 2026-10-30 (первая строка — адрес и дата): 90-З целиком, НК и ПСМ № 569
  обрезаны по границам абзацев, карточки, «Новые поступления», `robots.txt`; форматер их не трогает. «Иная вёрстка» — `layout-changed.ts`.
