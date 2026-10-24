# ADR-0001: Монорепозиторий и инструменты разработки

- **Статус:** Принято
- **Дата:** 2026-10-24
- **Требования:** NFR-10, NFR-11, NFR-13, NFR-14, NFR-17

## Контекст

Один разработчик и агенты пишут сайт, сервер с тремя процессами и общие пакеты на TypeScript. Схемы данных
должны быть общими для фронта и бэка; линтеры, форматтер, тесты и правила границ — едиными; CI нет
(публичного хостинга нет, NFR-17), поэтому git-хуки и `make check` — единственные ворота качества.

## Решение

- **pnpm 12** (строгий `node_modules`, `catalog:` для единых версий, `minimumReleaseAge`, `allowBuilds`)
  + **Turborepo** с минимальным `turbo.json` (кэш `typecheck`/`build`, `--affected`). Линт и формат — с корня.
- **Node.js 26 LTS** (LTS с 2026-10-28), без Bun.
- **Oxlint** (type-aware через `oxlint-tsgolint`, плагины react, jsx-a11y, import, vitest, unicorn, promise)
  и **oxfmt** (бета 0.x — **точная версия** в `package.json`, обновление отдельным коммитом с переформатированием).
- **dependency-cruiser 18** для границ модулей (ADR-0002, ADR-0003).
- **Vitest 5** (`projects`: unit, int, web; покрытие v8), **Playwright** + `@axe-core/playwright` для e2e.
- **lefthook** (без husky и lint-staged): `pre-commit` — `oxfmt --check` и `oxlint` по staged-файлам без
  автоправки; `commit-msg` — **commitlint** (`header-max-length 72`, `header-min-length 15`, `subject-case` выкл.
  для русских тем, `scope-enum` — id модулей и служебные области, область необязательна) + `tooling/check-commit-size.mjs`
  (предупреждение от 400 строк/20 файлов, отказ от 800/40 без трейлера `Large-Commit:`, меньше 3 строк — только
  `docs/chore/style/fix/revert` или трейлер `Small-Commit:`; lock-файл, миграционные снимки, кассеты не считаются);
  `pre-push` — `make check-quick`. Хук `commit-msg` отклоняет подписи ИИ (`Co-Authored-By: …`, «Generated with …»,
  упоминания модели): подписи ИИ в коммитах запрещены.
- **Makefile** — тонкая обёртка над `pnpm`, `docker compose` и `scripts/*.sh`; цели с `##` формируют `make help`;
  опасные цели спрашивают `yes`. Список целей — корневой `CLAUDE.md`.

## Альтернативы

- **Bun** — быстрее установка, но покрытие v8 Vitest не работает на Bun, второй рантайм в Docker.
- **Nx** — тяжёлый, навязывает структуру, границы завязаны на ESLint.
- **ESLint + Prettier** — хуже совместимы с TS 7; **Biome** — запасной вариант форматтера.
- **husky + lint-staged** — два инструмента вместо одного; автоправка в `pre-commit` ломает `git add -p`.

## Последствия

- Новая нативная зависимость требует строки в `allowBuilds` (это защита, а не баг).
- oxfmt может слегка менять формат между версиями — поэтому версия закреплена.
- `scope-enum` синхронизируется с `modules.ts` (генерируется в бетонной фазе) — новый модуль требует правки конфига.
- Хуки обходимы `--no-verify` — его блокирует хук Claude Code; `make check-commits` проверяет историю.

## Ссылки

`research/architecture/01-monorepo-tooling.md` (§1–3, §7–10, приложение А), `09-agent-dev-process.md` §4,
`10-consensus.md`; ADR-0002.
