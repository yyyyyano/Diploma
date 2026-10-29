---
paths:
  - "apps/server/src/modules/*/jobs/**"
  - "apps/server/src/modules/*/subscriptions/**"
  - "apps/server/src/modules/*/events.ts"
  - "apps/server/src/platform/{jobs,events,realtime}/**"
---
# Фоновые задачи, события, живые сигналы

Почему так — ADR-0004, ADR-0008; устройство — `docs/ARCHITECTURE.md` §5.

- Задача — `defineJob({ name: "<модуль>.<глагол>", payload: z.object(...), options, handle })`. В нагрузке — **только
  id** (никаких текстов, сумм, ПД — OBS-04); scope приходит в конверте (`ctx.s`), не в нагрузке.
- Событие — `<модуль>.<прошедшее время>`, схема в `events.ts` публикующего модуля; публикуется
  `events.publish(tx, name, payload)` **внутри той же транзакции**, что и запись данных.
- Нагрузка события — id **пачкой** (`{ ids: [...] }`, ≤ 1000): импорт 300 операций — одно событие.
- Обработчики **идемпотентны** (доставка «хотя бы раз», порядок не гарантирован): перечитай актуальное состояние
  через `s`, повтор не должен дублировать запись или уведомление (ключ идемпотентности: «лимит + месяц + порог»).
- Пересчёты — `singletonKey: (p, scope) => jobKey(scope, "budgets.recheck")` + небольшая задержка (схлопывание).
  Ключ без scope подавит задачу другого домохозяйства.
- Повтор — только для `retryable` ошибок (`AppError` каталога); остальное — в `background_job_run` с ошибкой.
- Расписание — `cron` по Минску + `missed: "once"` + «водяной знак» последнего обработанного периода (NFR-22);
  массовые проходы по pravo.by — только в ночном окне (LAW-35).
- «Для всех пользователей» — `defineSweep` (`*.sweep.ts`): найти `(id, householdId, userId)` → задача на каждого.
- Долгое — показывай прогресс: `platform.realtime.progress(s.scope, {...})`; «данные изменились» —
  `realtime.changed(s, { entity, ids })` с `ScopedDb` (внутри `s.transaction` — `tx`: NOTIFY уходит при коммите, при
  откате его нет). В сигнале — вид и id, без данных.
- Тяжёлое (PDF, XLSX, HEIC, QR, эмбеддинги) — только в задачах `worker` с таймаутом, не в обработчике HTTP; недоверенные
  файлы читаются ещё и в изолированном потоке (`platform/sandbox` → `runIsolated`, ADR-0022).
- Подписаться можно только на события модуля из своего `dependsOn`; файл — `subscriptions/on-<событие>.ts`.

Правильно:

```ts
export const onTransactionsChanged = defineSubscription({
  event: "transactions.changed",                        // схема — из index.ts модуля transactions
  options: { singletonKey: (_p, scope) => jobKey(scope, "budgets.recheck-thresholds"), startAfter: 2 },
  handle: (ctx, p) => recheckThresholds(ctx.s, p.ids),  // перечитывает лимиты и траты, уведомляет один раз на порог
});
```

Нельзя: `pg-boss` вне `platform/jobs`; публиковать событие после коммита отдельным вызовом; событие на каждую
операцию в цикле; нагрузка с текстом/суммой; обработчик, который верит нагрузке вместо БД; `setTimeout`/`setInterval`
вместо расписания.
