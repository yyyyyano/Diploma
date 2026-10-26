# Дизайн-система сайта `apps/web/src/ui` — «Пуща и янтарь» поверх Mantine 9

## Назначение
Компоненты представления по `design/kit.css` и `design/DESIGN.md` (ADR-0014): один вид для всех экранов, доступность
встроена в компонент. Только представление — без запросов, без бизнес-правил, без расчётов (P1). Правила —
`.claude/rules/frontend-ui.md`.

## Кто использует
`app` (каркас, экраны ошибки), `features/*`, `entities/*`; витрина всех состояний — `features/dev-gallery` (`/dev/gallery`).

## Публичный API
- Вход: `ui/index.ts` (компоненты), `ui/theme/index.ts` (стили один раз в `app`, `theme`, `cssVariablesResolver`,
  `CATEGORY_COLORS`, `CHART_COLORS`, `MAX_CHART_SERIES`), `ui/shell/index.ts` (части каркаса: меню, нижняя панель, `AppFrame` с углом `corner` — колокольчик над заголовком
  страницы; `PageHeader` оставляет под него место по `--k-corner`).
- Числа и статусы: `Money` (DES-17: `formatMoneyParts`, валюта мельче; `kind` доход «+» / расход «−» / перевод ⇄;
  `tabular` — табличные цифры, DES-07; `size="kpi"`), `WhyButton` (ⓘ, `aria-label` с названием числа), `Formula`
  (`dl`: строки и итог), `StatusBadge` (иконка обязательна — без неё не компилируется), `StatCard` (`tone`: free,
  benefit).
- Состояния экрана (DES-16): `EmptyState` (пусто и ошибка: `tone="error"`, `headingLevel`), `Skeleton`, `Loading`,
  `SkeletonCard`, `SkeletonList`, `SkeletonText` (`<output aria-busy>` + «Загрузка…»).
- Панели и подтверждения (P5): `Sheet` (Drawer 460 px справа или снизу), `ConfirmDialog` (кнопка-глагол, `tone`
  danger, `pending`), `UndoToast` (5 с, пауза при фокусе и указателе на «Отменить»), `PageHeader` (единственный h1).
- `Logo` — знак и название «Кошт» (`on`: light — белая шапка, dark — тёмная хвоя): шапки входа и первого запуска.
- Тема: `theme/tokens.css` — значения `design/tokens.css` + `--warn-bar` (SPEC §7.1); `theme/kit.css` — прочие
  значения набора (`--kit-*`, шкала `--s-<px>`, радиусы `--r-xs…--r-pill`); шрифты — `@fontsource-variable` (DES-09).

## Можно зависеть от
Mantine (`@mantine/core`, `@mantine/hooks`), `lucide-react`, `react-i18next` (подписи `ui:`), `@kosht/i18n` (форматы),
`@kosht/kernel` (типы). Нельзя: `lib/api`, `lib/events`, `entities`, `features`, TanStack Query, oRPC
(`ui-is-presentational` в `tooling/architecture/rules.ts`).

## Запреты
- Сырые цвета и числа отступов вне `ui/theme` (`no-raw-colors.mjs`); текст литералом (`jsx-literals.mjs`) — подписи
  пропсами или `t("ui:…")`; янтарь — только выгода; статус — никогда одним цветом.

## Как тестировать
- `pnpm vitest run --project web apps/web/src/ui`: компонентный тест на состояния и роли рядом с компонентом;
  каждое состояние — в `/dev/gallery`, `make e2e` прогоняет по ней axe (1440 и 390 px).

## Подводные камни
- oxfmt форматирует и CSS (hex строчными): `theme.test.ts` сверяет значения токенов с макетом, а не написание.
- Mantine рисует служебный `<style>` в корне провайдера: в тестах ищите элемент компонента, а не `firstElementChild`.
