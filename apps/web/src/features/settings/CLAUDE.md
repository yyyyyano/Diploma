# Экран `settings` — Настройки

Маршрут: `/settings` (`routes/_app/settings.tsx`) · доступ: пользователь (пункт меню в группе «Профиль»).

## Макет
- Исходник: `design/screens/Settings.dc.html`; описание — `design/SCREENS.md` § «Настройки».
- Скриншоты: `design/screenshots/desktop/Settings.png`, `design/screenshots/mobile-width/Settings.png`; состояния
  вкладок — `design/screenshots/states/Settings--*.png` (вкладки других задач).

## Требования SPEC
AUTH-03 (почта не подтверждена — отметка и «Отправить письмо ещё раз»); состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.identity.me` — email и `emailVerified`; `orpc.mail.status` — ссылка на локальный ящик.
- Изменение: `orpc.identity.resendVerification` — сразу, результат строкой («Письмо отправлено»), ошибка —
  `errors:<код>` с параметрами (`RATE_LIMITED` — «через N мин.»). Контекст ассистента: `staticData.page = "settings"`.

## Компоненты
Свои: `SettingsPage`, `EmailCard`. Из `ui`: `PageHeader`, `StatusBadge`, `EmptyState`, `SkeletonCard`. Mantine: `Tabs`,
`Button`.

## Переходы
«Открыть локальный ящик (демо)» → `/mailbox` (только пока почта не настроена и вход локальный).

## Отличия от макета (с причиной)
- Только вкладка «Профиль и вход» и в ней — только «Электронная почта»: пароль, код восстановления, «Где вы вошли» —
  T-013; «Конфиденциальность», «Мои данные» — T-016; «Уведомления» — T-015; Telegram — T-052 (ARCHITECTURE §10.5).
- Колокольчик в шапке — T-015.

## Готово, когда
Тесты (`SettingsPage.test.tsx`) зелёные; `make e2e` (`registration.spec.ts`) — axe 0 на 1440 и 390, без
горизонтальной прокрутки.
