# Экран `notifications` — Колокольчик уведомлений

Маршрута нет: колокольчик — в каркасе раздела (`app/shell/AppShell` → угол `AppFrame`) на каждой странице после входа.

## Макет
- Исходник: `design/screens/Main.dc.html`, состояние `design/screenshots/states/Main--notifications.png`.

## Требования SPEC
NOTIF-01 (колокольчик, счётчик, список, переход к объекту), NOTIF-03 (блок администратора), NOTIF-05 (кнопки);
доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.notifications.list` (`infiniteOptions`: курсор, «Показать ещё»), `orpc.notifications.adminList` —
  только `admin`. Обновление без перезагрузки — сигнал `notification` из `events.stream` (`lib/events`).
- Изменение: `markRead` (нажатие на кнопку уведомления), `markAllRead`, `adminMarkRead`; кнопки «Да/Нет» и
  «Отменить» — `orpc.actions.answer` / `orpc.actions.undo` прямо из `entities/notification`.

## Компоненты
Свои: `NotificationBell` (фокус — в список, Escape закрывает его и возвращает фокус колокольчику). Из `entities`:
`notification` (`NotificationItem`, `objectHref`). Mantine: `Popover`, `Button`.

## Переходы
«Настроить уведомления» → `/settings?tab=notifications`; «Показать» — раздел объекта (`objectHref`).

## Отличия от макета (с причиной)
- Время уведомления — днём («сегодня», «вчера», дата): формата времени суток в `@kosht/i18n` нет.
- Тексты видов — без подробностей (сумм, названий): источников уведомлений ещё нет, параметры добавят их задачи.

## Готово, когда
Тесты (`NotificationBell.test.tsx`) зелёные; `make e2e` (`notifications.spec.ts`) — axe 0 с открытым списком при
1440 и 390.
