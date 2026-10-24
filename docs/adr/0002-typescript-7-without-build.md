# ADR-0002: TypeScript 7 без шага сборки внутренних пакетов

- **Статус:** Принято
- **Дата:** 2026-10-24
- **Требования:** NFR-10, NFR-13

## Контекст

Правка в `packages/contract` должна сразу быть видна в `apps/web` и `apps/server` без промежуточной сборки.
TypeScript 7 (нативный компилятор) быстрее в 8–12 раз, но до 7.1 у него нет стабильного программного API, и
инструменты, встраивающие TypeScript, его не понимают. Главная ловушка: dependency-cruiser 18.7 с `typescript@7`
печатает предупреждение и сообщает «0 modules cruised, no violations» с кодом 0 — проверка границ молча пуста.

## Решение

- **TypeScript 7.0.x**, общий `tooling/tsconfig.base.json`: `module/moduleResolution: nodenext`, `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, **`erasableSyntaxOnly`**,
  `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `noEmit`, `types: ["node"]`. У `apps/web` —
  `moduleResolution: bundler`, `jsx: react-jsx`, DOM-библиотеки, `types: ["vite/client"]`.
- **Внутренние пакеты без сборки**: в `exports` — `./src/index.ts`; Node 26 запускает `.ts` сам
  (`node --watch src/entrypoints/api.ts`), Vite и Vitest читают исходники.
- Только **стираемый синтаксис**: без `enum`, `namespace`, параметров-свойств конструктора, декораторов.
  Импорты — относительные с расширением `.ts`, пакеты — `@kosht/*`; **без алиасов `@/`**.
- **Боевые образы**: каждая точка входа собирается **tsdown** в один `.mjs` (Node не стирает типы в файлах из
  `node_modules`, а `pnpm deploy` кладёт туда workspace-пакеты). Запасной сборщик — esbuild.
- **dependency-cruiser**: `typescript@^6` рядом через `packageExtensions` в `pnpm-workspace.yaml`, `parser: "tsc"`,
  резолвер workspace-пакетов (`exportsFields`, `conditionNames`, `extensions`), правило `not-to-unresolvable` и
  страховка `tooling/checks/deps-guard.mjs`: проверено меньше порога файлов → код 2, неразрешённые импорты → код 1.
  Когда выйдет поддержка TS ≥ 7.1 (dependency-cruiser 18.8) — обход снимается отдельной задачей.

## Альтернативы

- **TypeScript 6** — медленнее, Oxlint type-aware требует именно 7.
- **Сборка пакетов (tsdown/tsup/`tsc -b`)** — лишний шаг и рассинхрон «исходник ↔ dist» в разработке.
- **NestJS и декораторы** — несовместимы с `erasableSyntaxOnly`.

## Последствия

- Нельзя использовать `enum` — вместо них `as const` объекты и союзы строк.
- Любой инструмент, встраивающий TypeScript, проверяется на «не молчит ли он» (фикстура нарушения).
- Образ собирается шагом tsdown; нативные и динамические зависимости выводятся во внешние.

## Ссылки

`research/architecture/01-monorepo-tooling.md`, `13-code-architecture.md`; ADR-0001, ADR-0003.
