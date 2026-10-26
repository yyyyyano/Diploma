---
paths:
  - "Makefile"
  - "compose.yaml"
  - "docker/**"
  - "scripts/**"
  - "tooling/**"
  - "pnpm-workspace.yaml"
  - "turbo.json"
  - "lefthook.yml"
  - "commitlint.config.ts"
  - ".dependency-cruiser.mjs"
  - ".oxlintrc.json"
  - ".oxfmtrc.json"
  - "**/package.json"
  - "**/tsconfig*.json"
  - "**/vitest*.ts"
  - ".env.example"
---
# Запуск, инструменты, проверки

Почему так — ADR-0001, ADR-0002, ADR-0015; устройство — `docs/ARCHITECTURE.md` §2, §14; планка — `CONSTRAINTS.md`.

- **Makefile** — единственная точка входа (NFR-14): цель с `## описание` попадает в `make help`; опасные (`db-reset`,
  `restore`, `nuke`) — через `confirm` (ввод `yes`). Новая операция разработчика = новая цель, а не инструкция «запусти
  pnpm …». Источник списка целей — `make help`; обзор групп в корневом `CLAUDE.md` дополняется новой целью.
  `check` и `test-int` сами поднимают Postgres (`db-up`), если он не запущен.
- **Compose**: один `compose.yaml`, профили `app`, `models`, `observability` (+ `tools`); без профиля — только `db`.
  Порты всегда с адресом (`127.0.0.1:…`); у переменных профильных сервисов — значения по умолчанию
  (`${RENDER_GID:-992}`); `down`/`ps`/`logs` — с `--profile '*'`; том Postgres 18 — в `/var/lib/postgresql`; образы —
  точные теги (не `latest`); GPU — `devices: /dev/dri` + `group_add`; секреты — Compose `secrets:` из `secrets/`.
- **Образ** (`docker/Dockerfile`, контекст — белый список `docker/Dockerfile.dockerignore`): tsdown — один `.mjs` на
  точку входа (`apps/server/tsdown.config.ts`), `node:26-trixie-slim`, `USER node`, `read_only`, `cap_drop: ALL`,
  `init: true`, в Compose — пользователь хоста `${APP_UID}:${APP_GID}` (ADR-0015, T-011); миграции и выдача прав роли
  `kosht_app` — приложением при старте под владельцем (`MIGRATION_*`, папка — `MIGRATIONS_DIR`), боевой пул —
  `kosht_app` (ADR-0020); образ везёт `node_modules` рядом с бандлом (`pnpm deploy --prod`; `libpg-query` с `.wasm` — внешний, ADR-0019).
- **Секреты**: БД, мастер-ключ, ключи Langfuse для приложения — Compose `secrets:` из `secrets/`; сервисам Langfuse —
  `env_file: secrets/langfuse*.env` (их образы читают секреты только из окружения); всё создаёт `make init`.
- **Версии**: oxfmt, Drizzle, llama.cpp, AI SDK, pg-boss, OTel-пакеты Langfuse — **точные**; общие версии — через
  `catalog:` в `pnpm-workspace.yaml`; нативная зависимость — строка в `allowBuilds`; обновление мажора — отдельная задача.
- **dependency-cruiser**: правила генерируются из `tooling/architecture/modules.ts`; рядом `typescript@6`
  (`packageExtensions`); `deps-guard.mjs` с порогом `MIN_MODULES` (файлов) и требованием,
  чтобы в графе был `modules/<id>/index.ts` каждого модуля карты (иначе код 2). Новое правило ⇒ фикстура нарушения в
  `tooling/architecture/fixtures/` и тест «правило ловит своё». Правило, которое ничего не ловит, — сломанное правило.
- **Свои проверки** (`tooling/checks/*.mjs`) — маленькие, с кодом выхода 0/1/2 (2 — не смог проверить: нет файлов,
  меньше порога, внешний инструмент упал) и сообщением «файл:строка — что исправить», каждая — с тестом на
  фикстурах; запускаются целью `make static-checks`, она входит в `check` и `check-quick`.
- **Хуки git** (lefthook): `pre-commit` — только проверка staged-файлов без автоправки; `commit-msg` — commitlint,
  размер коммита, запрет подписей ИИ (`tooling/git-hooks/check-no-ai-attribution.mjs`); `pre-push` — `make check-quick`.
- `.env.example` — все переменные с безопасными умолчаниями и комментарием; `.env`, `secrets/`, `data/`, `models/`,
  `samples/` — в `.gitignore`.
- Пути и имена одинаковы в обоих режимах запуска (`./data/...`); `make doctor` (`tooling/doctor.ts`) проверяет Node,
  pnpm, Docker Engine (не Desktop), группы `docker`/`render`, свободные порты (своих контейнеров — свободны), версию
  Docker; `make dev` — код на хосте (`tooling/dev.ts`), модели — только `WITH_MODELS=1`.

Правильно:

```makefile
db-reset: confirm ## УДАЛИТЬ БД и создать заново (данные пропадут)
	$(DC) down -v db && $(MAKE) db-up migrate
```

Нельзя: ослабить порог, правило или `MIN_MODULES`, чтобы прошло; `latest` в образах; порт без адреса
(`5440:5432`); `--no-verify` в скриптах; `sudo` в целях Makefile; скачивание моделей или данных в обход загрузчика
приложения (NFR-25); правка `.claude/**` из задачи модуля.
