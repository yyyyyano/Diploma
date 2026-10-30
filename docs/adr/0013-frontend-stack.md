# ADR-0013: Фронтенд — Vite SPA, React 19, TanStack Router/Query, Mantine 9, свой чат на `useChat`

- **Статус:** Принято
- **Дата:** 2026-10-24
- **Требования:** NFR-19, NFR-20, NFR-21, DES-00…17, CHAT-01…09, DASH-01…04, P1, P9

## Контекст

Сайт на localhost (SEO и SSR не нужны), React по желанию пользователя, максимум готовых компонентов при минимуме
шаблонного кода: таблица с выбором строк, диапазон дат на русском, календарь событий, графики, формы, чат с
карточками. Внешний вид — по макету `design/` («Пуща и янтарь», Onest + Literata).

## Решение

- **Vite 8 + React 19**, SPA без SSR; сервер отдаёт статику, в разработке — Vite на `127.0.0.1:5173` с прокси.
- **TanStack Router** (файловые маршруты, типизированные параметры адреса = период, фильтры, контекст для агента).
- **Mantine 9** — UI-кит: тема из `design/tokens.css` (`createTheme` + точные hex), **Mantine Charts** (Recharts),
  **mantine-datatable** для таблицы операций (на телефоне — карточки), **@mantine/schedule** для календаря,
  Mantine Form + Zod 4 (`schemaResolver` со схемой из контракта). Иконки — Lucide.
- **TanStack Query 5** + клиент oRPC (`@orpc/tanstack-query`); инвалидация по SSE `events.stream`.
- **i18next + react-i18next** (типизированные ключи, словари в `packages/i18n`, общие с ботом и письмами); форматы —
  `formatMoney`/`formatDate`/`formatRelativeDay` из `packages/i18n` (DES-17): целочисленная арифметика без `Intl` —
  ICU ставит между разрядами то U+00A0, то U+202F, float теряет копейки; пояс `Europe/Minsk`
  (NFR-23) учтён в `LocalDate.fromInstant`, «сегодня» — вход из `Clock.today()`.
- **Чат**: `useChat` (AI SDK) с транспортом oRPC + свои компоненты на Mantine по макету (`Drawer`, `Popover`,
  `Collapse`, `Textarea` autosize); потоковый Markdown — `react-markdown` + `remend` + блоки в `memo`; автопрокрутка —
  `use-stick-to-bottom`; без веток диалога и покадрового «проявления слов».
- **Шрифты** — `@fontsource-variable/onest` и `@fontsource-variable/literata` (локально, DES-09).
- **Сайт денег не считает** (P1): `packages/calc` на сайте запрещён правилом границ; числа приходят с `traceId`.
- Голос — `MediaRecorder` (формат по `isTypeSupported`), фото — `FileButton`/`Dropzone` (`accept="image/*"`).
- Тесты — Vitest + Testing Library + MSW; Playwright + axe; вместо Storybook — маршрут `/dev/gallery`.

## Альтернативы

- **Next.js** — SSR и серверные компоненты не нужны на localhost, второй сервер.
- **MUI** — диапазон дат платный; **shadcn/ui** — теряем таблицу, календарь, графики Mantine.
- **AI Elements / prompt-kit / Streamdown** — Tailwind + shadcn, вторая система стилей; Streamdown мигает и без
  Tailwind выглядит «сломанным». **assistant-ui** — кандидат, если понадобятся ветки диалога.
- **Шрифты из исходного docx** (Playfair, Inter, JetBrains Mono) — заменены макетом (R42).

## Последствия

- Чат — около 340 строк своего кода на деталях Mantine; `@ai-sdk/react` импортируется только в `features/assistant`.
- Ползунок «Крупной покупки» пересчитывается на сервере (~50–100 мс) — исключение только через ADR.
- Без разбиения по маршрутам бандл ~352 КБ gzip — разбиение обязательно, бюджет — `CONSTRAINTS.md`.

## Дополнение (T-033, 2026-10-30): графики главной — свои, период — Mantine Dates

Замер (Vite 8.3.5, React 19, пустое приложение с `MantineProvider` как база — 80,9 КБ gzip): `@mantine/charts` 9.7.3 + `recharts`
3.10.1 с `BarChart` и `DonutChart` дают 201,1 КБ gzip, то есть **≈ 120 КБ** сверх базы; с кодом страницы чанк главной вплотную к
бюджету 150 КБ, а вид Recharts (оси, подсказки, анимации) расходится с макетом (CSS-столбцы, SVG-кольцо с подписью в центре,
`Main.dc.html:157-161, 479-511`). Решение: свои `ColumnChart` и `DonutChart` в `ui/components` (SVG и CSS, ≈ 3 КБ; доступность —
столбец-кнопка с подписью и скрытая таблица); `@mantine/charts` и `recharts` не подключаются. `@mantine/dates` 9.7.3 + `dayjs`
(выбор произвольного периода) — **≈ 48 КБ gzip**: влезает, подключён и грузится отдельным чанком (`lazy`), в первую загрузку не
входит. Откат — вернуть `@mantine/charts` и заменить два компонента (их интерфейс — данные и подписи, не Recharts).

## Ссылки

`research/architecture/07-frontend.md`, `11-chat-ui.md`, `13-code-architecture.md`, `10-consensus.md`; SPEC DES-00, R42; ADR-0014.
