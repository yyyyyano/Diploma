# Модуль `norm-tables`

Ярус 2 · таблицы: public, system · публикует: `norm-tables.values-confirmed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Таблица «параметр → период → значение → источник → кто и когда подтвердил» с подтверждением человеком (T-040): числа нормы (вычеты, ставки, пределы ПДН), которыми
считают налоги и безопасный платёж. Калькулятор получает только подтверждённое значение или явное «нет данных»; новые и изменённые вступают в силу после «Подтвердить».

## Требования SPEC
TAX-03, ADM-11, LAW-33, LEGAL-08, AFF-05 (пределы ПДН); CAL-02 (структура правил сроков) — T-048.

## Публичный API (`index.ts`)
- Фабрика: `createNormTablesModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `legalBase` (`fragmentsUnder`), `notifications` (`notifyAdmins`).
- Фасад: `rate(param, day)` → `RateAnswer`: `{ found: true, value, unit, source, confirmedBy, confirmedOn }` или `{ found: false, reason: "no-data" | "unconfirmed" }`; `admin`:
  `table()`, `propose(input)`, `confirm(s, id)`, `reject(id)`; `checkDrift()`. Событие `values-confirmed` (`{ ids }`) — от имени подтвердившего администратора.
- Значение — целое: копейки BYN (`byn-minor`) или сотые доли процента (`percent-bp`, 13 % = 1300); параметры — реестр `domain/params.ts`, новый параметр — строка там.
- Таблица `norm_rates` (publicTable): строка — версия значения; статусы `pending → confirmed → superseded | rejected`; история — сами строки. Подтверждение — транзакция: прежнее
  подтверждённое того же начала периода вытесняется, пересечение с другим периодом — `CONFLICT`. Кто подтвердил — `developer` или `admin` (id администратора не хранится).
- Начальное наполнение (миграция = `domain/seed-values.ts`, 2026 год): вычеты ст. 209 НК сверены с текстом из `legal-base/__fixtures__/pravo-by/Hk0900071.html` (30.10.2026) и
  поставляются «подтверждено разработчиком» (`seed-values.test.ts` сверяет числа с текстом); ставки ст. 214, 380, ИП, НПД (SPEC §9.1) и пределы ПДН (§9.3) в сохранённых
  страницах отсутствуют — они `pending`, калькулятор их не получит до «Подтвердить».
- Сверка LAW-33 (`drift-check.ts`): подписка на `legal-base.act-updated` — для подтверждённых значений текущего периода с источником в pravo.by ищет число в действующих
  фрагментах пункта (`fragmentsUnder`); нет — пометка `drift_at` и уведомление `rates-mismatch`, значение не меняется; число вернулось или подтверждено новое — пометка снимается.

## Зависимости
Можно: legal-base, notifications (`tooling/architecture/modules.ts`). Слушает: `legal-base.act-updated`.

## Запреты
- В чужой модуль — только через его `index.ts`; `SystemDb` — только свои таблицы. Значение не меняется само: ни сверкой, ни событием — только «Подтвердить».
- Числа не из текста нормы и не из источника — в начальное наполнение со статусом «подтверждено» не попадают.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/norm-tables` (unit и int); сквозной LAW-33 с настоящей новой редакцией — `main/admin-rates.int.test.ts`.
