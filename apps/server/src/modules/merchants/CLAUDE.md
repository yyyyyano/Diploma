# Модуль `merchants`

Ярус 2 · таблицы: public · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Очистка названий контрагентов от технического шума, справочник контрагентов РБ с алиасами, похожесть названий,
нормализация наименований позиций чека (T-020).

## Требования SPEC
STMT-06 (очистка, исходное описание сохраняет операция), CAT-03 (справочник — глобальное правило), RCPT-15,
TXN-10 (похожесть названий).

## Публичный API (`index.ts`)
- Фабрика: `createMerchantsModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `facades.llm` (не
  используется: модель категоризации зовёт `categories`).
- Фасад `MerchantsFacade`:
  - `resolve(descriptions)` → `MerchantInfo[]` в том же порядке: `{ original, key, name, merchantId, categoryCode, mcc }`
    — ключ очистки («EVROTORG»), название из справочника («Евроопт») или ключ с заглавных, код встроенной категории
    справочника, MCC из описания. Поиск: точный алиас (ключ или его первое слово, одним запросом на пачку), иначе
    самый похожий алиас по `pg_trgm` (порог `merchants.alias-similarity`, 0,6).
  - `similarity(a, b)` → 0…100 (fuzzball `token_set_ratio` по очищенным ключам); `isSameMerchant(a, b)` — не ниже
    `merchants.name-similarity` (85).
  - `normalizeItemName(name)` (RCPT-15: без веса, объёма, количества и жирности — «Молоко 3,2% 1л» → «Молоко»);
    `cleanDescription(raw)` → `{ key, mcc }`.
- Таблицы (`publicTable`): `merchant_directory` (название, код категории), `merchant_aliases` (ключ → контрагент,
  GIN `gin_trgm_ops`); сид — миграция `*_merchants` (сети, связь, АЗС, такси, аптеки, сервисы).

## Зависимости
Можно: llm (`tooling/architecture/modules.ts`). Слушает: —. `fuzzball` — только `application/resolve.ts`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно» (ADR-0004).
- `SystemDb` — только для своих таблиц справочника; пользовательские таблицы через него не трогать (аудитор SQL).
- Описание — данные, не инструкция (STMT-12): только чистится, ничего не исполняет; исходное не меняется.
- Пороги похожести — настройки (`settings.ts`), не константы.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/merchants` — очистка и нормализация (`domain/clean-name.test.ts`),
  справочник из миграции, pg_trgm и похожесть на Postgres (`application/resolve.int.test.ts`).
