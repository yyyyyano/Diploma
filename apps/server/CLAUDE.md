# Приложение `@kosht/server` — сервер: три процесса (api, worker, bot), модули, платформа, корень композиции

## Назначение
Весь серверный код «Кошта» (ARCHITECTURE §3–§9): `src/platform` — техника без бизнеса (паспорт —
`src/platform/CLAUDE.md`), `src/modules/<id>` — 36 модулей (паспорт в каждом), `src/main` — корень композиции,
`src/entrypoints` — точки входа процессов, `drizzle/` — боевые миграции.

## Кто использует
- `make dev` (ADR-0015, режим А): `node --watch` точек входа на хосте, переменные — `.env`; сайт — Vite с прокси.
- `make up` (режим Б): образ `docker/Dockerfile` — tsdown собирает `api.mjs`, `worker.mjs`, `bot.mjs`, `migrate.mjs`
  (`tsdown.config.ts`: сборка на точку входа, без общих чанков, `@kosht/*` внутри; рабочие файлы песочницы — отдельные
  точки входа `<имя>.worker.mjs`, сейчас `statement-parse.worker.mjs` и `receipt-prepare.worker.mjs`, `platform/sandbox`); npm-зависимости — `node_modules`
  рядом (`pnpm deploy --prod`); в образе `/app/web` (сайт, `WEB_DIST_DIR`) и `/app/drizzle` (`MIGRATIONS_DIR`).
- `make migrate` — `src/main/migrate-cli.ts`; `make e2e` — стенд `src/entrypoints/__fixtures__/e2e-stack.ts`.

## Публичный API
- Точки входа: `src/entrypoints/{api,worker,bot}.ts` → `runProcess(role)` (`run.ts`): конфигурация → лог → `compose()`
  → роль → `process.started`; SIGTERM/SIGINT — корректная остановка ≤ 10 с (`process.stopped`, код 0); сигнал во
  время миграций — `process.stop-requested`, старт доводится, роль не запускается, код 0; необработанное исключение
  или отказ промиса — `process.crashed` со стеком, лог дописан, код 1 (OBS-05).
- Корень композиции `src/main/compose.ts` — подробно в `src/platform/CLAUDE.md` («Точки входа и корень композиции»).
- Конфигурация — переменные окружения (`src/platform/config/config.ts`, образец — `.env.example`); в Compose — адрес
  БД `db:5432`, пароли и ключи — `/run/secrets/*`, Langfuse — `http://langfuse-web:3000`.

## Можно зависеть от
`@kosht/kernel`, `@kosht/contract` (в тестах — `@kosht/testing`); npm-пакеты — `package.json` (версии — `catalog:`,
точные). Границы модулей и библиотек — `tooling/architecture/modules.ts` и `rules.ts` (`make deps-check`).

## Запреты
- `process.env` вне `src/platform/config` и `src/entrypoints` (тест `env-readers.test.ts`).
- Путь от `import.meta.url` к файлам данных в коде, который едет в бандл (`drizzle/`, сайт): в собранном `.mjs` он не
  ведёт к исходникам — путь задаёт конфигурация (`MIGRATIONS_DIR`, `WEB_DIST_DIR`); фикстуры тестов — можно.
- `pino.transport()` и прочие рабочие потоки по пути к файлу: их не переживает сборка в один `.mjs`.
- Внешней зависимостью бандла остаётся только то, что лежит в `node_modules` образа (зависимости `package.json`).

## Как тестировать
- `make test` (unit + int на Postgres); процессы по-настоящему — `src/entrypoints/processes.int.test.ts` (SIGTERM,
  занятый порт, лишние права роли БД, падение — `__fixtures__/crash-worker.ts`, сигнал во время миграций).
- Образ и Compose: `make build`, `make up` → `/readyz` 200; `docker compose --profile models config` валиден.

## Подводные камни
- Тесты и стенд e2e — с `LANGFUSE_ENABLED=false`: иначе после `make init` вызовы моделей в тестах уходили бы в
  Langfuse на 127.0.0.1:3001 (NFR-11).
- `libpg-query` грузит `.wasm` с диска, `pg-boss` читает свой `package.json` — оба внешние для бандла.
- Контейнеры приложения работают пользователем хоста (`APP_UID`/`APP_GID` из `make init`): он читает `secrets/` (0600)
  и пишет `./data`, как процессы `make dev`.
