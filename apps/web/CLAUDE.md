# Приложение `@kosht/web` — сайт: Vite 8 + React 19 SPA, TanStack Router и Query, Mantine 9

## Назначение
Экраны «Кошта» по макету `design/` и требованиям SPEC (DES-00): слои FSD-lite `app → routes → features →
entities → ui / lib` (ADR-0014, ARCHITECTURE §10). Денег не считает (P1): числа приходят с сервера готовыми.

## Кто использует
Браузер пользователя: в разработке — Vite на `127.0.0.1:5173` с прокси `/api` → `127.0.0.1:8140` (без
`changeOrigin`: сервер сверяет `Host` и `Origin`); в работе — статика `apps/web/dist` из процесса `api`.

## Публичный API
- Вход: `index.html` → `src/main.tsx` (стили темы, `App` с источником сессии).
- `app/`: `App` (провайдеры), `createAppRouter({ queryClient, session, history? })` (контекст роутера: `queryClient`,
  `session`, `Shell`; граница ошибок `ErrorScreen`, «нет страницы» `NotFoundScreen`), `shell/AppShell` (меню из
  реестра маршрутов под роль, поток событий, выход).
- `routes/`: `__root`, `_app` (каркас из контекста), `_app/admin` (`beforeLoad`: `requireRole(…, "admin")` → иначе
  «нет такой страницы»), `dev.gallery` (витрина; только разработка и `--mode e2e`). Группы `_public`, `_local`
  появляются с первой страницей (T-009): пустые группы генератор маршрутов считает одним путём «/».
- Пункт меню — `staticData: { nav: { group, order, section, icon, phoneOrder?, role? }, page }` в файле маршрута;
  нет маршрута — нет пункта (DES-15).
- `lib/`: `api` (`client`, `orpc` — queryOptions/mutationOptions), `events` (`useEventStream`, `runEventStream`,
  `progressQueryKey`), `i18n`, `session` (`SessionSource`, `requireRole`, `signOut` → `queryClient.clear()`), `nav`.
- Дизайн-система — `src/ui/CLAUDE.md`; витрина — `src/features/dev-gallery/CLAUDE.md`.

## Можно зависеть от
`@kosht/kernel`, `@kosht/contract`, `@kosht/i18n` (в тестах — `@kosht/testing`); npm-пакеты — `package.json`
(версии — `catalog:`). Границы слоёв — правила `web-*` и `ui-is-presentational` в `tooling/architecture/rules.ts`.

## Запреты
- `fetch` мимо `lib/api`; импорт `apps/server`, `@kosht/calc`; данные пользователя в `localStorage`.
- Текст литералом в JSX (`jsx-literals.mjs`), сырые цвета и отступы вне `ui/theme` (`no-raw-colors.mjs`).
- Маршрут импортирует только `features/<x>/index.ts` и `lib` (`web-routes-thin`); каркас — из контекста роутера.

## Как тестировать
- `pnpm vitest run --project web` — jsdom, Testing Library, MSW (неописанный запрос — ошибка); CSS-модули с
  читаемыми классами. `make e2e` — Playwright + axe по сборке `--mode e2e`.
- Дерево маршрутов `src/routeTree.gen.ts` генерируется (turbo `generate` перед `typecheck`, плагин Vite в
  `vite`/`vitest`) и не коммитится.

## Подводные камни
- Боевая сборка (`vite build`) перегенерирует `routeTree.gen.ts` без `dev.*`; следующий `make typecheck` вернёт их.
- `useQuery` не хранит `undefined`: гость в кэше сессии — `null`.
- Поток `events.stream` на `changed` перезапрашивает все активные запросы; на `UNAUTHORIZED` не переподключается.
