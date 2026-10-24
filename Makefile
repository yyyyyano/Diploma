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
BASE ?= main
DC := docker compose

# Расширения, которые форматирует oxfmt и проверяет oxlint (остальное — молча пропускаем).
FMT_EXT := ts tsx mts cts js mjs cjs json jsonc yml yaml
LINT_EXT := ts tsx mts cts js mjs cjs
FILE_EXT = $(lastword $(subst ., ,$(notdir $(FILE))))

.PHONY: help install init fmt fmt-check format-file lint lint-file typecheck test check check-quick \
	check-commits need-node capabilities deps-check static-checks db-up db-shell

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

init: install secrets/db_password ## Первый запуск: зависимости, .env из .env.example, пароль БД в secrets/, git-хуки
	@if [ -f .env ]; then echo ".env уже есть — не трогаю."; else cp .env.example .env && echo "Создан .env из .env.example."; fi
	$(BIN)/lefthook install

# Пароль БД (NFR-16): создаётся один раз, существующий не меняется; читают его Compose (secrets:) и приложение.
secrets/db_password:
	@umask 077 && mkdir -p secrets && node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > $@
	@echo "Создан $@ — пароль БД (вне git)."

# ── База данных ────────────────────────────────────────────────────────────────────────────────────

db-up: secrets/db_password ## Поднять только Postgres (сервис db) и дождаться готовности; запущенный не трогает
	@$(DC) --progress quiet up -d --wait db

db-shell: db-up ## Открыть psql в базе kosht
	$(DC) exec db psql -U kosht -d kosht

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
	$(if $(filter $(FILE_EXT),$(LINT_EXT)),@$(BIN)/oxlint --deny-warnings --no-error-on-unmatched-pattern "$(FILE)",@:)

typecheck: need-node ## Проверка типов TypeScript 7 во всех пакетах (Turborepo)
	$(BIN)/turbo run typecheck --output-logs=errors-only

test: need-node ## Все тесты Vitest с покрытием (пороги — vitest.config.ts, CONSTRAINTS.md)
	$(BIN)/vitest run --coverage

deps-check: need-node ## Границы модулей (dependency-cruiser из modules.ts) + страховка «проверено 0 файлов»
	node tooling/checks/deps-guard.mjs

# Свои проверки tooling/checks/*.mjs (T-056): все запускаются, даже если первая нашла нарушение; код — худший
# из кодов (2 «не смог проверить» важнее 1 «нарушение»).
STATIC_CHECKS := isolation no-raw-colors calc-no-clock jsx-literals floor

static-checks: need-node ## Свои проверки (tooling/checks): изоляция, сырые цвета, часы в calc, литералы JSX, «Пол»
	@rc=0; for c in $(STATIC_CHECKS); do node tooling/checks/$$c.mjs || { s=$$?; if [ $$s -gt $$rc ]; then rc=$$s; fi; }; done; exit $$rc

check: fmt-check lint typecheck deps-check static-checks test ## Все проверки: формат, линт, типы, границы, свои проверки, тесты («готово» = зелёный)

check-quick: typecheck deps-check static-checks ## Быстрые проверки для pre-push: типы, границы, свои проверки и тесты без БД
	$(BIN)/vitest run --project unit

check-commits: need-node ## Проверить коммиты ветки относительно BASE (по умолчанию main)
	node tooling/git-hooks/check-commits.mjs $(BASE)

# ── Заготовки ──────────────────────────────────────────────────────────────────────────────────────

capabilities: need-node ## Перегенерировать таблицы ярусов docs/CAPABILITIES.md из tooling/architecture/modules.ts
	node tooling/architecture/capabilities.ts
