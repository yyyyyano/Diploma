# Модуль `notifications`

Ярус 1 · таблицы: user, system · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Уведомления пользователя (центр с колокольчиком, настройки по видам и каналам) и уведомления администраторов; реестр
каналов доставки (web — свой, telegram — T-053). Источники уведомлений — задачи своих модулей (бюджеты, чеки…).

## Требования SPEC
NOTIF-01…05, BUD-03, CAL-07 (доставка).

## Публичный API (`index.ts`)
- Фабрика: `createNotificationsModule({ platform, facades })`; платформа — `SystemPlatform` (таблицы user и system);
  фасады — `facades.identity`, `facades.privacy`. Каналы — `platform.deliveryChannels()` (реестр корня композиции,
  позднее связывание).
- Фасад `NotificationsFacade`: `notify(s, { kind, key, objectRef?, decisionId?, undoToken?, params? })` → id или
  `undefined` (такой вид + ключ уже есть — идемпотентно); новое уходит в каждый канал, где вид не отключён (строки
  настройки нет — включено). `notifyAdmins({ kind, key, objectRef?, params? })` — без `ScopedDb`, идемпотентно.
- Каталог видов — `USER_NOTIFICATION_KINDS` (NOTIF-02) и `ADMIN_NOTIFICATION_KINDS` (NOTIF-03) в `@kosht/contract`;
  текст — на сайте и в боте из словаря `notifications` по виду и параметрам. Кнопки «Да/Нет» и «Отменить» —
  `decisionId`/`undoToken` в `actions` (от `actions` модуль не зависит), «Показать» — `objectRef`.
- Канал `web` (`application/web-channel.ts`): `shown_on_web` + `realtime.changed(s, { entity: "notification" })`.
- Контракт `contract.notifications.*`: authed — `list` (курсор = id последнего, uuidv7; `unread`), `markRead` (только
  свои), `markAllRead`, `preferences` (вид × web/telegram), `setPreference`; admin — `adminList`, `adminMarkRead`.
- Таблицы: `notifications`, `notification_preferences` (`userOwnedTable`, `user-data.ts`); `admin_notifications`,
  `admin_notification_reads` (`systemTable`: без домохозяйства, «прочитано» — строка на администратора; при удалении
  аккаунта их убирает хук `afterDelete` владельца данных — `forgetAdmin`).

## Зависимости
Можно: identity, privacy (`tooling/architecture/modules.ts`). Слушает: `privacy.export-ready` →
`subscriptions/on-export-ready.ts`: готовность перечитывается `privacy.isExportReady(ctx.s, id)`, затем
`notify(data-export-ready, ключ — id заявки, объект `data-export`)` (PRIV-05).

## Запреты
- Вопрос «Да/Нет» не хранится здесь — только `decisionId` ожидающего решения `actions`.
- Параметры уведомления — числа и id; ПД и тексты документов в параметры и логи не пишутся.
- Данные домохозяйства — только через `s.own(таблица)`; `SystemDb` — только таблицы администраторов.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/notifications` — идемпотентность, матрица вид × канал, курсор, «прочитано»,
  администраторы (`application/notifications.int.test.ts`); роли сквозь HTTP — `main/notifications.int.test.ts`.
