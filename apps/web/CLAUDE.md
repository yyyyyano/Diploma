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
- `routes/`: `__root`; `index` — стартовый «/» (вошедший → `/onboarding`, пока анкета `pending`, иначе `/home`;
  гость → `/setup`, если `setupAvailable`, иначе `/login`); `onboarding` (анкета, без каркаса, AUTH-07); `_public/login`, `_public/register` (гость), `_public/verify-email`, `_public/recovery`, `_public/policy` (все);
  `_local/setup` (только пока `setupAvailable`), `_local/mailbox` (ящик; на сетевом входе сервер — `NOT_FOUND`); `_app`
  (`beforeLoad`: `requireUser` → без сессии `/login`; каркас из контекста), `_app/home` (главная, период — `?from=&to=`), `_app/accounts`, `_app/recurring` (вкладка — `?section=`), `_app/budget`, `_app/operations` (адрес — `features/operations/model/search.ts`), `_app/assistant`, `_app/memory`,
  `_app/settings`, `_app/admin` (`requireRole(…, "admin")`
  → иначе «нет такой страницы»; вкладки `_app/admin/users`, `_app/admin/system`, `_app/admin/ai-requests` (период — `?period=`), `_app/admin/ai-providers`, `/admin` → `/admin/users`), `dev.gallery` (витрина; только разработка и `--mode e2e`).
- Пункт меню — `staticData: { nav: { group, order, section, icon, phoneOrder?, role? }, page }` в файле маршрута;
  нет маршрута — нет пункта (DES-15).
- `lib/`: `api` (`client`, `orpc` — queryOptions/mutationOptions; `fetch` — в момент запроса), `events`
  (`useEventStream`, `runEventStream`, `progressQueryKey`, привязка «сущность → запросы»), `errors` (`errorCodeOf` → код для `errors:<код>`,
  `errorParamsOf` → параметры текста, `retryAfterMinutes`, `name` и `date` всегда есть), `i18n`,
  `session` (`createApiSession`, `sessionQuery`/`SESSION_QUERY_KEY`, `currentUser`, `requireUser`, `requireRole`,
  `signOut` → `queryClient.clear()`), `nav`.
- `entities/account` — `AccountCard` (вид, остаток и день остатка, эквивалент в BYN; ⓘ и меню — слотами страницы),
  `useAccountName`; `entities/recovery-code` — `RecoveryCode` (показ кода один раз, «Скопировать»); `entities/receipt` — `ReceiptStatusBadge`, `PendingBadge`, форматы количества и копеек (RCPT-07);
  `entities/explanation` — `ExplanationSheet` (панель «Откуда эта цифра?» по `traceId`: `explain.get`, справа или
  шторкой на телефоне), `ExplanationView`, `formulaLabel`, `refHref`; `entities/action` — `UndoActionToast`
  (`actions.undo`), `DecisionDialog` (`actions.decision`/`answer`, вопрос — `decisionText` по ключу `decisions.<вид>`; `onAnswered(status,
  undoToken)` — «Отменить» сразу после «Да»; ошибка «Да» — в окне, конфликт с причиной — `decisions:conflict.<причина>`;
  `confirmLabel` — «Да, перенести 13»);
  `entities/category` — `CategoryPicker` (встроенные и свои нужного типа, «Новая категория»), `CategoryBadge`, `useCategoryLookup`, `categoryName`, `refKey`;
  `entities/transaction` — `TransactionAmount` (эквивалент в BYN, исходная валюта, «курс не получен»), `moneyKindOf`;
  `entities/goal` — `GoalCard` (цель с процентом, взносом, «укладывается», отставанием; `variant`: full / compact), `ContributeDialog` (взнос в копилку: `budgets.contribute`, `onDone` отдаёт `undoToken`); `entities/profile-fact` — `FactEditor`, `FactValueText`, `factLabel`, `keyLabel` (факт профиля словами и форма по
  ключу); `entities/notification` — `NotificationItem` (кнопки «Показать», «Да/Нет», «Отменить»), `objectHref`; экраны `features/setup`, `features/auth`, `features/mailbox`, `features/settings`,
  `features/notifications`, `features/accounts`, `features/dashboard`, `features/recurring`, `features/budget`, `features/operations`, `features/admin`, `features/onboarding`, `features/memory`,
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
- Поток `events.stream` на `changed` перезапрашивает запросы только своей сущности (`ENTITY_QUERIES` в `lib/events.ts`:
  `account`, `receipt`, `transaction`, `category`, `notification`, `profile-fact`, `chat-message`, `data-export`, `recurring`, `budget`, `goal`; запросы `dashboard` обновляются по всем, что меняет числа главной); сущности, которой там
  нет, — все запросы (безопасное умолчание); новая сущность сигнала — строка в `ENTITY_QUERIES`. На `UNAUTHORIZED` не
  переподключается.
