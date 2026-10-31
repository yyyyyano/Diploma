# «Кошт» — единая точка входа разработчика (NFR-14, ADR-0001). Список целей: make help.
# Каждую цель добавляет задача, которая даёт её функцию; целей-заглушек нет (CONSTRAINTS.md).

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

# Node по .node-version. Хуки Claude Code и git запускаются с унаследованным PATH, где впереди может стоять
# другой Node: если нужная версия есть в nvm, ставим её первой в PATH для всех рецептов.
NODE_VERSION := $(shell cat .node-version 2>/dev/null)
NVM_DIR ?= $(HOME)/.nvm
NODE_BIN := $(shell ls -d $(NVM_DIR)/versions/node/v$(NODE_VERSION).*/bin 2>/dev/null | sort -V | tail -n 1)
ifneq ($(NODE_BIN),)
export PATH := $(NODE_BIN):$(PATH)
endif

# Всё локально: без телеметрии и проверки обновлений Turborepo.
export TURBO_TELEMETRY_DISABLED := 1
export TURBO_NO_UPDATE_NOTIFIER := 1

BIN := node_modules/.bin
# Программы сервера читают переменные из .env, если он есть (окружение проверяет platform/config); агент .env не
# открывает — его читает только node.
NODE_APP := node --env-file-if-exists=.env
BASE ?= main
DC := docker compose

# Расширения, которые форматирует oxfmt и проверяет oxlint (остальное — молча пропускаем).
FMT_EXT := ts tsx mts cts js mjs cjs json jsonc yml yaml
LINT_EXT := ts tsx mts cts js mjs cjs
FILE_EXT = $(lastword $(subst ., ,$(notdir $(FILE))))

.PHONY: help install init fmt fmt-check format-file lint lint-file typecheck test check check-quick \
	check-commits need-node capabilities deps-check static-checks db-up db-shell migrate db-generate \
	test-int logs log-find new-module new-table synth-statements synth-receipts e2e e2e-install new-feature ai-record coverage-baseline \
	langfuse-secrets doctor dev up down restart ps build db-reset backup restore confirm audit check-full

help: ## Показать команды
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN { FS = ":.*?## " } { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }'

need-node:
	@v=$$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "нет"); \
	if [ "$$v" != "$(firstword $(subst ., ,$(NODE_VERSION)))" ]; then \
		echo "Нужен Node $(NODE_VERSION) (файл .node-version), а найден: $$v. Установите: nvm install $(NODE_VERSION)" >&2; \
		exit 1; \
	fi

# ── Первый запуск ──────────────────────────────────────────────────────────────────────────────────

install: need-node ## Установить зависимости по pnpm-lock.yaml
	pnpm install --frozen-lockfile

# Существующий .env правит программа (ADR-0020: старые умолчания владельца → роль приложения, дописать MIGRATION_*;
# T-011: факты машины для Compose — группа render и пользователь контейнеров), печатая только имена переменных; make и
# агент его не читают.
RENDER_GID_HOST = $(shell getent group render 2>/dev/null | cut -d: -f3)

init: install secrets/db_password secrets/db_app_password secrets/master.key langfuse-secrets ## Первый запуск: зависимости, .env из .env.example (существующий — обновить, RENDER_GID и APP_UID машины), секреты БД, мастер-ключ и Langfuse в secrets/, git-хуки
	@if [ ! -f .env ]; then cp .env.example .env && echo "Создан .env из .env.example."; fi
	@node tooling/upgrade-env.ts .env "RENDER_GID=$(RENDER_GID_HOST)" "APP_UID=$$(id -u)" "APP_GID=$$(id -g)"
	$(BIN)/lefthook install

# Пароль владельца БД (NFR-16): создаётся один раз, существующий не меняется; читают его Compose (secrets:),
# миграции и выдача прав роли приложения.
secrets/db_password:
	@umask 077 && mkdir -p secrets && node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > $@
	@echo "Создан $@ — пароль БД (вне git)."

# Пароль роли приложения kosht_app (NFR-16, ADR-0020): роль создаёт и приводит в порядок приложение при старте и
# make migrate; существующий не меняется.
secrets/db_app_password:
	@umask 077 && mkdir -p secrets && node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > $@
	@echo "Создан $@ — пароль роли приложения БД (вне git)."

# Мастер-ключ секретов (NFR-16, ADR-0016): 32 случайных байта, права 0600; существующий не меняется — с новым ключом
# сохранённые в админке секреты станут «не читается». В резервную копию не входит.
secrets/master.key:
	@umask 077 && mkdir -p secrets && node -e 'process.stdout.write(require("node:crypto").randomBytes(32))' > $@
	@echo "Создан $@ — мастер-ключ секретов (вне git и вне резервной копии)."

# Секреты Langfuse (ADR-0010): значения — один раз (secrets/langfuse.json), файлы для Compose пишутся заново каждый
# запуск (программа молчит, если ничего не создано).
langfuse-secrets: need-node
	@node tooling/langfuse-secrets.ts secrets

# ── Запуск (ADR-0015) ──────────────────────────────────────────────────────────────────────────────────────────────

# Модели (llama-server, whisper.cpp) поднимаются только явно: make up WITH_MODELS=1 (загрузчик моделей — T-024).
WITH_MODELS ?=
MODELS_PROFILE = $(if $(filter 1,$(WITH_MODELS)),--profile models)
# Langfuse включён по умолчанию (OBS-05, ADR-0010); первый его старт — до 2–3 минут.
UP_TIMEOUT := 600
SECRETS := secrets/db_password secrets/db_app_password secrets/master.key
DATA_DIRS := data/files data/logs data/backups data/exports data/models

doctor: need-node ## Проверить машину: Node, pnpm, Docker Engine (не Desktop, ≥ 28.3.3), группы docker и render, свободные порты
	@node tooling/doctor.ts

dev: need-node $(SECRETS) langfuse-secrets ## Разработка: db и Langfuse в контейнерах, api/worker/bot (node --watch) и Vite 127.0.0.1:5173 на хосте [WITH_MODELS=1]
	@$(DC) --progress quiet --profile observability $(MODELS_PROFILE) up -d --wait --wait-timeout $(UP_TIMEOUT)
	@echo "Сайт: http://127.0.0.1:5173 · Langfuse: http://127.0.0.1:3001 · остановка: Ctrl+C, контейнеры — make down"
	@node tooling/dev.ts

up: need-node $(SECRETS) langfuse-secrets ## Всё в контейнерах: сборка образа, db, api, worker, bot, Langfuse; ждёт готовности [WITH_MODELS=1]
	@mkdir -p $(DATA_DIRS)
	$(DC) --profile app --profile observability $(MODELS_PROFILE) up -d --build --wait --wait-timeout $(UP_TIMEOUT)
	@echo "Кошт: http://127.0.0.1:8140 · Langfuse: http://127.0.0.1:3001 (вход — secrets/langfuse_admin_password)"

down: need-node langfuse-secrets ## Остановить все контейнеры проекта (все профили); данные в томах остаются
	$(DC) --profile '*' down

restart: ## Перезапустить контейнеры: make down, затем make up
	@$(MAKE) down
	@$(MAKE) up

ps: need-node langfuse-secrets ## Контейнеры проекта (все профили) и их состояние
	$(DC) --profile '*' ps

build: need-node ## Собрать образ приложения kosht-app:local (сайт, сервер tsdown, node_modules сервера)
	$(DC) --profile app build

# Подтверждение опасных целей: ввод yes (docker-tooling.md). Без терминала — отказ.
confirm:
	@printf '%s' "$${CONFIRM_TEXT:-Продолжить?} Введите yes: "; read -r answer; [ "$$answer" = yes ] || { echo "Отменено."; exit 1; }

# ── База данных ────────────────────────────────────────────────────────────────────────────────────

db-up: secrets/db_password ## Поднять только Postgres (сервис db) и дождаться готовности; запущенный не трогает
	@$(DC) --progress quiet up -d --wait db

db-reset: need-node $(SECRETS) ## УДАЛИТЬ базу kosht (том pgdata) и создать заново с миграциями — спросит yes
	@CONFIRM_TEXT="База kosht и все её данные будут удалены." $(MAKE) -s confirm
	$(DC) --profile app stop api worker bot
	$(DC) rm --force --stop db
	docker volume rm --force kosht_pgdata
	@$(MAKE) db-up migrate

# Резервная копия (ADR-0015): pg_dump -Fc под владельцем + файлы пользователей; мастер-ключ в копию не входит
# (NFR-16): без него сохранённые в админке секреты в копии не прочитать — так и задумано.
BACKUP_DIR := data/backups

backup: need-node $(SECRETS) db-up ## Резервная копия: data/backups/kosht-<время>.tar (pg_dump -Fc + data/files), без мастер-ключа
	@set -eu; stamp=$$(date +%Y%m%d-%H%M%S); tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	mkdir -p $(BACKUP_DIR) data/files; \
	$(DC) exec -T db pg_dump -U kosht -d kosht -Fc > "$$tmp/db.dump"; \
	tar -C data -cf "$$tmp/files.tar" files; \
	tar -C "$$tmp" -cf "$(BACKUP_DIR)/kosht-$$stamp.tar" db.dump files.tar; \
	chmod 600 "$(BACKUP_DIR)/kosht-$$stamp.tar"; \
	echo "Копия: $(BACKUP_DIR)/kosht-$$stamp.tar (без мастер-ключа)."

# Восстановление поверх текущих данных: процессы приложения останавливаются, база kosht пересоздаётся пустой и
# заполняется pg_restore (а не --clean: секции таблиц pg-boss не удаляются по одной), файлы заменяются. Роль kosht_app
# — роль кластера, права на таблицы — в самой копии. Имя файла — из окружения рецепта, а не подстановкой в текст.
restore: need-node $(SECRETS) db-up ## Восстановить из копии: make restore file=data/backups/kosht-….tar — ЗАМЕНИТ базу и файлы, спросит yes
	@test -n "$${file:-}" -a -f "$${file:-}" || { echo "Укажите копию: make restore file=data/backups/kosht-….tar" >&2; exit 2; }
	@CONFIRM_TEXT="База kosht и data/files будут заменены копией." $(MAKE) -s confirm
	@set -eu; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	tar -C "$$tmp" -xf "$${file}" db.dump files.tar; \
	$(DC) --profile app stop api worker bot; \
	$(DC) exec -T db psql -U kosht -d postgres -v ON_ERROR_STOP=1 -q \
		-c 'DROP DATABASE IF EXISTS kosht WITH (FORCE)' -c 'CREATE DATABASE kosht OWNER kosht'; \
	$(DC) exec -T db pg_restore -U kosht -d kosht --exit-on-error < "$$tmp/db.dump"; \
	rm -rf data/files && tar -C data -xf "$$tmp/files.tar"; \
	echo "Восстановлено из $${file}. Запуск: make up или make dev."

db-shell: db-up ## Открыть psql в базе kosht
	$(DC) exec db psql -U kosht -d kosht

migrate: need-node db-up secrets/db_app_password ## Применить миграции apps/server/drizzle, поставить схему очереди pgboss и выдать права роли приложения — под владельцем БД (приложение делает то же при старте)
	$(NODE_APP) apps/server/src/main/migrate-cli.ts

# Тестовая схема механизма изоляции: make db-generate DRIZZLE_CONFIG=apps/server/src/platform/db/__fixtures__/drizzle.config.ts
DRIZZLE_CONFIG ?= apps/server/drizzle.config.ts

db-generate: need-node ## Миграция из схем модулей: [name=имя] [custom=1 — пустая, для SQL руками]; SQL читать глазами
	apps/server/node_modules/.bin/drizzle-kit generate --config $(DRIZZLE_CONFIG) $(if $(name),--name $(name)) $(if $(custom),--custom)
	@$(BIN)/oxfmt apps/server/drizzle apps/server/src/platform/db/__fixtures__/drizzle >/dev/null

# ── Логи ───────────────────────────────────────────────────────────────────────────────────────────

# Логи ролей (OBS-06): <LOG_DIR>/<роль>.<гггг-ММ-дд>.<n>.log, 14 файлов на роль. При своём DATA_DIR — LOG_DIR=…/logs.
LOG_DIR ?= data/logs
PINO_PRETTY := apps/server/node_modules/.bin/pino-pretty

logs: need-node ## Хвост логов ролей api, worker, bot — читаемо (pino-pretty) [LOG_DIR=data/logs]
	@files=$$(for r in api worker bot; do { ls -1t $(LOG_DIR)/$$r.*.log 2>/dev/null || true; } | head -n 1; done); \
	test -n "$$files" || { echo "В $(LOG_DIR) нет логов: сервер ещё не запускался." >&2; exit 1; }; \
	tail -q -n 100 -F $$files | $(PINO_PRETTY)

# id берётся из окружения рецепта ("$${id}"), а не подставляется в текст команды: кавычки в id не станут командой.
log-find: need-node ## Строки логов всех ролей с одним requestId, по времени: make log-find id=<requestId>
	@test -n "$${id:-}" || { echo "Укажите id: make log-find id=<requestId>" >&2; exit 2; }
	@node apps/server/src/platform/logging/log-find-cli.ts "$(LOG_DIR)" "$${id}" | $(PINO_PRETTY)

# ── Качество ───────────────────────────────────────────────────────────────────────────────────────

fmt: need-node ## Отформатировать код и конфиги (oxfmt)
	$(BIN)/oxfmt .

fmt-check: need-node ## Проверить формат без правки
	$(BIN)/oxfmt --check .

format-file: need-node ## Отформатировать один файл: make format-file FILE=путь (прочие типы пропускаются)
	@test -n "$(FILE)" || { echo "Укажите файл: make format-file FILE=путь" >&2; exit 2; }
	$(if $(filter $(FILE_EXT),$(FMT_EXT)),@$(BIN)/oxfmt --no-error-on-unmatched-pattern "$(FILE)" >/dev/null,@:)

lint: need-node ## Линт всего кода (Oxlint, type-aware), предупреждения — тоже ошибка
	$(BIN)/oxlint --deny-warnings .

lint-file: need-node ## Линт одного файла: make lint-file FILE=путь (прочие типы пропускаются)
	@test -n "$(FILE)" || { echo "Укажите файл: make lint-file FILE=путь" >&2; exit 2; }
	$(if $(filter $(FILE_EXT),$(LINT_EXT)),@$(BIN)/oxlint --deny-warnings --no-error-on-unmatched-pattern --format=unix "$(FILE)",@:)

typecheck: need-node ## Проверка типов TypeScript 7 во всех пакетах (Turborepo)
	$(BIN)/turbo run typecheck --output-logs=errors-only

test: need-node db-up secrets/db_app_password ## Все тесты Vitest (unit и int на Postgres) с покрытием (пороги — vitest.config.ts, база — tooling/coverage-baseline.json)
	$(BIN)/vitest run --coverage
	node tooling/checks/coverage-baseline.mjs

# База покрытия (T-011): падение больше 0,5 п. п. от неё — красный make test; поднять её после новых тестов — эта
# цель, опустить она отказывается (CONSTRAINTS «Пол»).
coverage-baseline: need-node db-up secrets/db_app_password ## Прогнать тесты с покрытием и поднять базу tooling/coverage-baseline.json (опустить — нельзя)
	$(BIN)/vitest run --coverage
	node tooling/checks/coverage-baseline.mjs --write

test-int: need-node db-up secrets/db_app_password ## Интеграционные тесты на настоящем Postgres: своя база на тестовый файл
	$(BIN)/vitest run --project int

# Бюджеты времени (CONSTRAINTS «Бюджеты времени»): `*.bench.ts` рядом с кодом, настоящий Postgres, синтетический набор;
# p95 печатается из реального прогона. Свой конфиг — `make test` и `make check` замеров не гоняют (под нагрузкой других
# тестов p95 врал бы).
bench: need-node db-up secrets/db_app_password ## Замеры бюджетов времени (p95) на синтетических наборах: страница операций ≤ 150 мс и др.
	$(BIN)/vitest run -c vitest.bench.config.ts --reporter=verbose

deps-check: need-node ## Границы модулей (dependency-cruiser из modules.ts) + страховка «проверено 0 файлов»
	node tooling/checks/deps-guard.mjs

# Свои проверки tooling/checks/*.mjs (T-056): все запускаются, даже если первая нашла нарушение; код — худший
# из кодов (2 «не смог проверить» важнее 1 «нарушение»).
STATIC_CHECKS := isolation no-raw-colors calc-no-clock jsx-literals floor

static-checks: need-node ## Свои проверки (tooling/checks): изоляция, сырые цвета, часы в calc, литералы JSX, «Пол»
	@rc=0; for c in $(STATIC_CHECKS); do node tooling/checks/$$c.mjs || { s=$$?; if [ $$s -gt $$rc ]; then rc=$$s; fi; }; done; exit $$rc

check: fmt-check lint typecheck deps-check static-checks test ## Все проверки: формат, линт, типы, границы, свои проверки, тесты («готово» = зелёный)

# Уязвимости боевых зависимостей (CONSTRAINTS «Уязвимости зависимостей»): pnpm audit --prod — high и выше краснит;
# osv-scanner — вторым мнением, если установлен.
audit: need-node ## Уязвимости боевых зависимостей: pnpm audit --prod (high и выше — ошибка) и osv-scanner, если есть
	pnpm audit --prod --audit-level high
	@if command -v osv-scanner >/dev/null 2>&1; then osv-scanner scan source --lockfile pnpm-lock.yaml; else echo "osv-scanner не установлен — пропущен."; fi

check-full: check e2e audit ## Всё перед защитой: check + e2e + audit + бюджет JS сайта (боевая сборка)
	cd apps/web && node node_modules/vite/bin/vite.js build --logLevel warn
	node tooling/checks/bundle-size.mjs apps/web/dist

check-quick: typecheck deps-check static-checks ## Быстрые проверки для pre-push: типы, границы, свои проверки и тесты без БД
	$(BIN)/vitest run --project unit

# e2e (T-008, T-009, CONSTRAINTS «Доступность»): Playwright сам собирает сайт (vite build --mode e2e — с витриной
# /dev/gallery) и поднимает стенд: api и worker на своей свежей базе и 127.0.0.1:8150 (рабочие 8140 и дев-база не
# трогаются); axe на каждом маршруте при 1440 и 390 px. Chromium — своей сборки Playwright: нет его в кэше —
# подсказка make e2e-install, а не скачивание из цели проверки.
PLAYWRIGHT := node_modules/.bin/playwright

e2e: need-node db-up secrets/db_app_password ## e2e сайта на своём стенде (api, worker, своя база): Playwright + axe (WCAG 2.2 AA) при 1440 и 390 px; Chromium — make e2e-install
	@dir=$$(cd e2e && $(PLAYWRIGHT) install --dry-run chromium 2>/dev/null | awk '/Install location/ { print $$3; exit }'); \
	test -n "$$dir" && test -d "$$dir" || { echo "Нет Chromium для Playwright — установите: make e2e-install" >&2; exit 2; }
	cd e2e && $(PLAYWRIGHT) test

e2e-install: need-node ## Скачать Chromium своей версии Playwright для make e2e (~170 МБ, в ~/.cache/ms-playwright)
	cd e2e && $(PLAYWRIGHT) install chromium

# Кассеты моделей (QA-17, NFR-11): тесты сценария (AI_RECORD=<сценарий>) пишут кассету заново в record, остальные —
# повтор. С тестового провайдера — без сети и ключей; с облачными моделями (T-023) — тратит лимиты, ключи читает
# программа. Перезапись — отдельным коммитом test(...).
ai-record: need-node db-up secrets/db_app_password ## Перезаписать кассеты сценария моделей: make ai-record SCENARIO=<модуль>/<имя>
	@printf '%s' "$${SCENARIO:-}" | grep -Eq '^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$$' || { echo "Укажите сценарий: make ai-record SCENARIO=chat/accounts" >&2; exit 2; }
	AI_RECORD="$${SCENARIO}" $(BIN)/vitest run --project int

check-commits: need-node ## Проверить коммиты ветки относительно BASE (по умолчанию main)
	node tooling/git-hooks/check-commits.mjs $(BASE)

# ── Заготовки ──────────────────────────────────────────────────────────────────────────────────────

capabilities: need-node ## Перегенерировать таблицы ярусов docs/CAPABILITIES.md из tooling/architecture/modules.ts
	node tooling/architecture/capabilities.ts

# Заготовки модулей (T-007, ARCHITECTURE §4.1) — только из карты tooling/architecture/modules.ts. Значения проверяет
# программа, а в команду они попадают из окружения рецепта ("$${id}"), а не подстановкой в текст.
new-module: need-node ## Модуль сервера из modules.ts: make new-module id=<id> (паспорт, index.ts, module.ts, сборка в main/)
	@test -n "$${id:-}" || { echo "Укажите модуль: make new-module id=<id>" >&2; exit 2; }
	@node tooling/gen/new-module.ts "$${id}"
	@$(BIN)/oxfmt "apps/server/src/modules/$${id}" apps/server/src/main/create-modules.ts >/dev/null

# Заготовка экрана сайта (T-008, ADR-0014) — только экран из таблицы «Экраны сайта» docs/CAPABILITIES.md.
new-feature: need-node ## Экран сайта: make new-feature id=<id> (паспорт по шаблону, index.ts в apps/web/src/features/<id>)
	@test -n "$${id:-}" || { echo "Укажите экран: make new-feature id=<id>" >&2; exit 2; }
	@node tooling/gen/new-feature.ts "$${id}"
	@$(BIN)/oxfmt "apps/web/src/features/$${id}" >/dev/null

synth-statements: need-node ## Пересоздать синтетические выписки datasets/statements (tooling/synth, T-025; детерминированно)
	@node tooling/synth/statements/generate.ts

synth-receipts: need-node ## Пересоздать синтетические чеки datasets/receipts (tooling/synth, T-027; нужен ffmpeg с libx265 для HEIC)
	@node tooling/synth/receipts/generate.ts
	@$(BIN)/oxfmt datasets/receipts >/dev/null

new-table: need-node ## Таблица модуля: make new-table module=<id> name=<таблица> [kind=user|system|public] (+ defineUserData)
	@test -n "$${module:-}" -a -n "$${name:-}" || { echo "Укажите: make new-table module=<id> name=<таблица> [kind=user]" >&2; exit 2; }
	@node tooling/gen/new-table.ts "$${module}" "$${name}" "$${kind:-user}"
	@$(BIN)/oxfmt "apps/server/src/modules/$${module}" >/dev/null
