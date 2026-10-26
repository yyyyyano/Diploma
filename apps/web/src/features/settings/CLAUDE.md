# Экран `settings` — Настройки

Маршрут: `/settings` (`routes/_app/settings.tsx`) · доступ: пользователь (пункт меню в группе «Профиль»).

## Макет
- Исходник: `design/screens/Settings.dc.html`; описание — `design/SCREENS.md` § «Настройки».
- Скриншоты: `design/screenshots/desktop/Settings.png`, `design/screenshots/mobile-width/Settings.png`; состояния
  вкладок — `design/screenshots/states/Settings--*.png` (вкладки других задач).

## Требования SPEC
AUTH-03 (почта не подтверждена — отметка и «Отправить письмо ещё раз»), AUTH-05 (код восстановления), AUTH-08 (смена
пароля, выход); состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.identity.me` — email и `emailVerified`; `orpc.mail.status` — ссылка на локальный ящик.
- Изменение: `orpc.identity.resendVerification` — сразу, результат строкой («Письмо отправлено»), ошибка —
  `errors:<код>` с параметрами (`RATE_LIMITED` — «через N мин.»). Контекст ассистента: `staticData.page = "settings"`.
- Пароль: `orpc.identity.changePassword` (форма — `ChangePasswordInput` + повтор; прочие сеансы завершаются).
- Код: `orpc.identity.recoveryCodeStatus` («Кода пока нет» / «Код создан …»), `createRecoveryCode` — код показан один
  раз (`entities/recovery-code`), «Я сохранил(а) код» прячет его. Выход: `orpc.identity.signOut` → `queryClient.clear()`
  → `/login`.

## Компоненты
Свои: `SettingsPage`, `EmailCard`, `PasswordCard`, `RecoveryCodeCard`, `SignOutCard`. Из `entities`:
`recovery-code`. Из `ui`: `PageHeader`, `StatusBadge`, `EmptyState`, `SkeletonCard`. Mantine: `Tabs`,
`Button`.

## Переходы
«Открыть локальный ящик (демо)» → `/mailbox` (только пока почта не настроена и вход локальный).

## Отличия от макета (с причиной)
- Только вкладка «Профиль и вход»: «Конфиденциальность», «Мои данные» — T-016; «Уведомления» — T-015; Telegram —
  T-052 (ARCHITECTURE §10.5). Вместо «Где вы вошли» (список сеансов) — карточка «Выход»: списка сеансов нет в
  контракте; смена пароля и так завершает другие сеансы.
- Плашка «Пароль был сброшен администратором» — T-017. Подсказка пароля — «не короче 12» (SEC-01), а не «10» макета.
- Колокольчик в шапке — T-015.

## Готово, когда
Тесты (`SettingsPage.test.tsx`) зелёные; `make e2e` (`registration.spec.ts`) — axe 0 на 1440 и 390, без
горизонтальной прокрутки.
