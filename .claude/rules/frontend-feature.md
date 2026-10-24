---
paths:
  - "apps/web/src/features/**"
  - "apps/web/src/entities/**"
  - "apps/web/src/routes/**"
  - "apps/web/src/app/**"
  - "apps/web/src/lib/**"
---
# Экран и фича сайта

Почему так — ADR-0013, ADR-0014; устройство — `docs/ARCHITECTURE.md` §10; карта экранов — `docs/CAPABILITIES.md`.

- Начни с паспорта фичи (`features/<id>/CLAUDE.md`): `design/screens/<Экран>.dc.html` (тексты, разметка, поведение),
  `design/screenshots/desktop|mobile-width/<Экран>.png`, состояния `design/screenshots/states/<Экран>--*.png`,
  `design/SCREENS.md`, требования SPEC. Внешний вид — по макету, поведение — по SPEC (DES-00); намеренное отличие —
  в итог задачи. Демо-цифры макета в код не переносятся.
- Слои: `routes` (тонкие) → `features` → `entities` → `ui`, `lib`. Фича не импортирует другую фичу: переход —
  `Link` с типизированными параметрами, вопрос ассистенту — `lib/assistant-bridge`, общий виджет — в `entities`
  (переноси туда, когда он понадобился второй фиче).
- Данные — только `orpc.<процедура>.queryOptions/mutationOptions` из `lib/api`; инвалидация — по `events.stream` и
  после своих мутаций. Числа не считать на клиенте (P1): сумма, процент, остаток приходят готовыми с `traceId`.
- Состояние страницы (период, фильтры, открытая карточка) — в адресе: Zod-схема в `model/search.ts`, маршрут
  передаёт её в `validateSearch`; `staticData.page` — для контекста ассистента (CHAT-08).
- Формы — Mantine Form + `schemaResolver(<схема входа из @kosht/contract>)` (одна схема для формы и сервера, сообщения —
  ключи i18n, Zod 4 с локалью `ru`); ошибки сервера — `t("errors:КОД", params)`.
- Каждый экран — четыре состояния (DES-16): загрузка (скелетон той же формы), пусто (что здесь будет и 1–3 первых
  шага), ошибка (что случилось и что сделать), успех. Одиночное действие — сразу и `UndoToast`; удаление и массовое —
  `ConfirmDialog` с перечнем изменений и кнопкой-глаголом («Да, перенести 13»).
- Только компоненты `ui/` и Mantine; у каждой суммы — `<Money>` и `WhyButton`; статус — с иконкой или текстом.
- Телефон: 390 px без горизонтальной прокрутки страницы, широкие таблицы — прокрутка внутри блока или карточки,
  цели касания ≥ 44 px.
- При выходе и смене пользователя — `queryClient.clear()`; данные пользователя не в `localStorage`.
- Кусок экрана, зависящий от ещё не готового модуля, скрыт; его встраивает задача того модуля, она же делает
  `entities/<x>` и контракт (`docs/ARCHITECTURE.md` §10.5).
- Готово, когда: компонентные тесты состояний зелёные, `make e2e` (axe 0 нарушений на 1440 и 390), скриншоты 1440 и
  390 сверены с макетом.

Правильно:

```tsx
// routes/_app/operations.tsx — тонкий маршрут
export const Route = createFileRoute("/_app/operations")({
  validateSearch: OperationsSearch,
  staticData: { page: "operations" },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(orpc.transactions.list.queryOptions({ input: toListInput(deps) })),
  component: () => <OperationsPage search={Route.useSearch()} />,
});
```

Нельзя: `fetch` мимо `lib/api`; импорт `apps/server`, `packages/calc`; `useState` для фильтров, которые должны
жить в адресе; сумма или процент, посчитанные в компоненте; модалка подтверждения для одиночного действия.
