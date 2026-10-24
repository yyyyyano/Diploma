# Пакет `@kosht/i18n` — тексты и форматы: словари ru, типизированные ключи, `createT`

## Назначение
Весь текст для человека (NFR-19) — в одном месте для сайта, бота, писем и уведомлений. Отдельный пакет: тексты
меняются ради интерфейса и не тянут за собой сервер. Правила — `.claude/rules/i18n.md`.

## Кто использует
`apps/web` (react-i18next на тех же `resources`, T-008), `apps/server` (бот, письма, уведомления).

## Публичный API
- Вход: `packages/i18n/src/index.ts`.
- `createT(language = "ru")` — свой экземпляр i18next без React; `T` — тип перевода. Ключ — `<ns>:<ключ>`
  (`common:relativeDay.today`); несуществующий ключ или пространство имён не компилируется.
- `resources` (`{ ru: { common, errors, formulas, tools } }`), `NAMESPACES`, `LANGUAGES`, `Language`, `Namespace`.
- Словари (`locales/ru/`): `common` (общее; множественные числа `count.operations_*`), `errors` — по одному тексту на
  `ErrorCode` контракта (`satisfies Record<ErrorCode, string>`), `formulas` — подписи ключей трассы calc
  (`fin.freeBalance`), `tools` — подписи шагов агента по имени инструмента (`fallback` — запасная).
- Множественные числа: `_one` (1, 21, 101), `_few` (2–4, 22), `_many` (0, 5–20, 25, 111) **и `_other`** (дроби);
  число в тексте — `{{count, number}}` («1,5 операции»).

## Можно зависеть от
`@kosht/kernel`, `@kosht/contract`, `i18next` (версия — `catalog:`); в тестах ещё `@kosht/calc` — правило
`i18n-allowed-deps` в `tooling/architecture/rules.ts`.

## Запреты
- Импорт приложений и серверного кода; React — только на сайте (react-i18next), не здесь.
- Склейка строк вместо параметров; текст для человека вне словаря.

## Как тестировать
- `pnpm vitest run packages/i18n`; «не компилируется» (чужой ключ) — тест с `@ts-expect-error`.
- Соответствие коду — `resources.test.ts`: тексты на все коды каталога ошибок, подпись `fin.freeBalance`.

## Подводные камни
- `escapeValue: false`: экранирует канал вывода (React, шаблон письма, бот), а не перевод.
- Глобальный экземпляр `i18next` не используется: у каждого `createT` свой.
