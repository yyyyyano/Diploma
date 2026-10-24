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
- **Образ**: сборка точек входа tsdown в `.mjs`, `node:26-trixie-slim`, `USER node`, `read_only`, `cap_drop: ALL`,
  `init: true`; миграции — приложением при старте.
- **Версии**: oxfmt, Drizzle, llama.cpp, AI SDK, pg-boss, OTel-пакеты Langfuse — **точные**; общие версии — через
  `catalog:` в `pnpm-workspace.yaml`; нативная зависимость — строка в `allowBuilds`; обновление мажора — отдельная задача.
- **dependency-cruiser**: правила генерируются из `tooling/architecture/modules.ts`; рядом `typescript@6`
  (`packageExtensions`); `deps-guard.mjs` с порогом `MIN_MODULES`. Новое правило ⇒ фикстура нарушения в
  `tooling/architecture/fixtures/` и тест «правило ловит своё». Правило, которое ничего не ловит, — сломанное правило.
- **Свои проверки** (`tooling/checks/*.mjs`) — маленькие, с кодом выхода 0/1 и сообщением «что и где исправить»,
  каждая — с тестом на фикстурах.
- **Хуки git** (lefthook): `pre-commit` — только проверка staged-файлов без автоправки; `commit-msg` — commitlint,
  размер коммита, запрет подписей ИИ (`tooling/git-hooks/check-no-ai-attribution.mjs`); `pre-push` — `make check-quick`.
- `.env.example` — все переменные с безопасными умолчаниями и комментарием; `.env`, `secrets/`, `data/`, `models/`,
  `samples/` — в `.gitignore`.
- Пути и имена одинаковы в обоих режимах запуска (`./data/...`); `make doctor` проверяет Node, pnpm, Docker Engine
  (не Desktop), группы `docker`/`render`, свободные порты, версию Docker.

Правильно:

```makefile
db-reset: confirm ## УДАЛИТЬ БД и создать заново (данные пропадут)
	$(DC) down -v db && $(MAKE) db-up migrate
```

Нельзя: ослабить порог, правило или `MIN_MODULES`, чтобы прошло; `latest` в образах; порт без адреса
(`5440:5432`); `--no-verify` в скриптах; `sudo` в целях Makefile; скачивание моделей или данных в обход загрузчика
приложения (NFR-25); правка `.claude/**` из задачи модуля.
