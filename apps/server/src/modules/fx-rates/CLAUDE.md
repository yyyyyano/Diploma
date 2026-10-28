# Модуль `fx-rates`

Ярус 2 · таблицы: public · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Курсы НБРБ по ISO-коду с кэшем, эквивалент в BYN с курсом в трассе (T-019).

## Требования SPEC
STMT-09 (курс на дату операции, кэш, выходной — последний установленный), SPEC §9.8 (API НБРБ).

## Публичный API (`index.ts`)
- Фабрика: `createFxRatesModule({ platform, facades }, source?)`; платформа — `SystemPlatform` (с `system: SystemDb`);
  фасады — `facades.explain` (не используется: трассу сохраняет модуль, показывающий число); `source` — порт
  `FxRatesSource` (по умолчанию адаптер НБРБ `infrastructure/nbrb.ts`; тесты подставляют фикстуры).
- Фасад `FxRatesFacade` (звать **вне транзакций** — внутри HTTP):
  - `rateOn(currency, day)` → `FxRate { id, currency, rateDate, rateE4, scale }` или `undefined` (за окно поиска
    курса нет или НБРБ недоступен); BYN — `RangeError` (не спрашивается).
  - `convert(key, amount: Calc<Money>, day)` → `{ calc, rate }` (BYN — та же трасса и `rate: null`; иначе
    `@kosht/calc` `toByn`: сумма × курс ÷ масштаб, до копейки, курс — узел `fx.rate` со ссылкой `fxRate:<id>`, масштаб
    — `fx.scale`) или `undefined` — курса нет: итог в BYN не показывают, а не считают нулём.
- Порт `FxRatesSource.rateOn(currency, day)` → курс или `null` (пустой ответ, 404 — на этот день курса нет).
- Настройки (`settings.ts`): `fx-rates.lookback-days` (7 — сколько дней назад искать курс), `fx-rates.timeout-ms`
  (5000 — таймаут запроса к НБРБ).
- Таблица `fx_rates` (`publicTable`): курс на запрошенный день (`on_date`), день установки (`rate_date`), курс в
  десятитысячных (`rate_e4`) и масштаб; уникальность (валюта, день). На сегодня «вчерашний» курс пишется на свой день
  — сегодняшний ещё может появиться; прошедшие дни кэшируются навсегда.

## Зависимости
Можно: explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно» (ADR-0004).
- `SystemDb` — только для своей таблицы `fx_rates`; пользовательские таблицы через него не трогать (аудитор SQL).
- Курс — целым в десятитысячных (без float); в BYN пересчитывает только `@kosht/calc` `toByn`.
- Сеть — только адаптер НБРБ, по ISO-коду (Cur_ID меняется), с таймаутом; тесты — фикстуры
  `infrastructure/__fixtures__/nbrb-*.json`, без интернета (NFR-11).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/fx-rates` — разбор курса и календарь (`domain/fx-rate.test.ts`), адаптер на
  фикстурах (`infrastructure/nbrb.test.ts`), кэш, выходные, недоступность и пересчёт на Postgres
  (`application/rates.int.test.ts`).
