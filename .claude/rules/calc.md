---
paths:
  - "packages/calc/**"
  - "packages/kernel/**"
---
# Расчёты (`packages/calc`) и общие примитивы (`packages/kernel`)

Почему так — ADR-0017; устройство — `docs/ARCHITECTURE.md` §7.

- `calc` импортирует только `@kosht/kernel`; `kernel` — только `zod`. Ни БД, ни сети, ни файлов, ни `Date.now()`,
  ни `new Date()` без аргумента, ни `Math.random()`, ни `Intl` для логики (проверяют dependency-cruiser —
  `calc-only-kernel`, `web-only-shared-packages` — и `calc-no-clock.mjs`).
- Каждая функция: `вход → Calc<T> = { value, trace }`. «Сегодня», ставки (`norm-tables`), пороги (настройки), курсы —
  **во входе**. Трасса `TraceNode { key, op, value, inputs[], refs[], note? }` — из помощников
  `node/sum/sub/mul/mulRate/avg/round`; `key` — ключ подписи из словаря `formulas` (`fin.freeBalance`), `refs` — операции,
  версии фрагментов норм (`fragmentVersionId`), курсы. Новый показатель = функция + ключ в `formulas` + тест-пример.
- Деньги — `Money { minor, currency }` в целых копейках; операции над деньгами разных валют без явного пересчёта —
  ошибка; проценты и ставки — базисные пункты (`1300` = 13 %) или десятичные строки; округление явное, с правилом
  (до копейки, банковское — где требует норма) и шагом в трассе.
- Функция называет требование: `/** TAX-05: вычет не больше уплаченного налога; остаток переносится. */`.
- Тесты — в той же папке, **каждый пример из SPEC** — отдельный тест с человеческим названием (TAX-07, FIN-20, AFF-05,
  BUD-05, RCPT-05, КП REC/BUD/AFF); где есть свойства (сумма частей = целое, идемпотентность нормализации) —
  fast-check. Планка покрытия `calc` — самая высокая (`CONSTRAINTS.md`).
- `kernel` меняется редко: `Scope` (бренд, создаётся только `makeScope` на входах), `Money`, `LocalDate`, `Period`,
  `Clock` (интерфейс; реализация — `platform/clock`, в тестах `FakeClock`), бренды id, `TraceNode`. Новый общий тип — только если он нужен минимум двум пакетам/приложениям.

Правильно:

```ts
/** TAX-07, пример 1: обучение 2 000 BYN → экономия 260 BYN при ставке 13 %. */
export function socialDeductionSaving(input: { paid: Money; taxableIncome: Money; rateBp: Calc<number> }): Calc<Money> {
  const base = minMoney("tax.deductionBase", input.paid, input.taxableIncome);
  return mulRate("tax.saving", base, input.rateBp, { rounding: "half-up-kopeck" });
}
// it("обучение 2 000 BYN даёт 260,00 BYN экономии и переносит 0", …)
```

Нельзя: `number` с рублями (`12.5`); `toFixed` для денег; «магические» ставки и суммы в коде (только вход из
`norm-tables`); расчёт без трассы; побочные эффекты; импорт `calc` в `apps/web`.
