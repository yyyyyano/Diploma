# Приложение `@kosht/web` — сайт: Vite 8 + React 19 SPA, TanStack Router и Query, Mantine 9

## Назначение
Экраны «Кошта» по макету `design/` и требованиям SPEC (DES-00): слои FSD-lite `app → routes → features →
entities → ui / lib` (ADR-0014, ARCHITECTURE §10). Денег не считает (P1): числа приходят с сервера готовыми.

## Кто использует
Браузер пользователя: в разработке (`make dev`) — Vite на `127.0.0.1:5173` с прокси `/api` → `127.0.0.1:8140` (без
`changeOrigin`: сервер сверяет `Host` и `Origin`, поэтому `TRUSTED_ORIGINS` пуст); в работе — статика из процесса
`api`: `apps/web/dist` на хосте, в образе (`make up`) — `/app/web` (`vite build` в `docker/Dockerfile`).

## Публичный API
- Вход: `index.html` → `src/main.tsx` (стили темы, `App` с сессией `createApiSession(client)` — процедуры identity).
- `app/`: `App` (провайдеры), `createAppRouter({ queryClient, session, history? })` (контекст роутера: `queryClient`,
  `session`, `Shell`; граница ошибок `ErrorScreen`, «нет страницы» `NotFoundScreen`), `shell/AppShell` (меню из
  реестра маршрутов под роль, поток событий, выход, колокольчик `features/notifications` в углу `AppFrame`).
- `routes/`: `__root`; `index` — стартовый «/» (вошедший → `/accounts`, гость → `/setup`, если `setupAvailable`, иначе
  `/login`); `_public/login`, `_public/register` (гость), `_public/verify-email`, `_public/recovery`, `_public/policy` (все);
  `_local/setup` (только пока `setupAvailable`), `_local/mailbox` (ящик; на сетевом входе сервер — `NOT_FOUND`); `_app`
  (`beforeLoad`: `requireUser` → без сессии `/login`; каркас из контекста), `_app/accounts`, `_app/assistant`,
  `_app/settings`, `_app/admin` (`requireRole(…, "admin")`
  → иначе «нет такой страницы»; вкладки `_app/admin/users`, `_app/admin/system`, `/admin` → `/admin/users`), `dev.gallery` (витрина; только разработка и `--mode e2e`).
- Пункт меню — `staticData: { nav: { group, order, section, icon, phoneOrder?, role? }, page }` в файле маршрута;
  нет маршрута — нет пункта (DES-15).
- `lib/`: `api` (`client`, `orpc` — queryOptions/mutationOptions; `fetch` — в момент запроса), `events`
  (`useEventStream`, `runEventStream`, `progressQueryKey`), `errors` (`errorCodeOf` → код для `errors:<код>`,
  `errorParamsOf` → параметры текста, `retryAfterMinutes` всегда есть), `i18n`,
  `session` (`createApiSession`, `sessionQuery`/`SESSION_QUERY_KEY`, `currentUser`, `requireUser`, `requireRole`,
  `signOut` → `queryClient.clear()`), `nav`.
- `entities/account` — `AccountCard`; `entities/recovery-code` — `RecoveryCode` (показ кода один раз, «Скопировать»);
  `entities/explanation` — `ExplanationSheet` (панель «Откуда эта цифра?» по `traceId`: `explain.get`, справа или
  шторкой на телефоне), `ExplanationView`, `formulaLabel`, `refHref`; `entities/action` — `UndoActionToast`
  (`actions.undo`), `DecisionDialog` (`actions.decision`/`answer`, вопрос — `decisionText` по ключу `decisions.<вид>`);
  `entities/notification` — `NotificationItem` (кнопки «Показать», «Да/Нет», «Отменить»), `objectHref`; экраны `features/setup`, `features/auth`, `features/mailbox`, `features/settings`,
  `features/notifications`, `features/accounts`, `features/admin`,
  `features/assistant` (единственное место AI SDK на сайте — правило `ai-only-in-web-assistant`).
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
