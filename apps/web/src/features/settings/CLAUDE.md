# Экран `settings` — Настройки

Маршрут: `/settings?tab=profile|privacy|notifications|my-data` (`routes/_app/settings.tsx`, адрес — `model/search.ts`)
· доступ: пользователь (пункт меню в группе «Профиль»).

## Макет
- Исходник: `design/screens/Settings.dc.html`; описание — `design/SCREENS.md` § «Настройки».
- Скриншоты: `design/screenshots/desktop/Settings.png`, `design/screenshots/mobile-width/Settings.png`; состояния
  вкладок — `design/screenshots/states/Settings--*.png` (вкладки других задач).

## Требования SPEC
AUTH-03 (почта не подтверждена — отметка и «Отправить письмо ещё раз»), AUTH-05 (код восстановления), AUTH-08 (смена
пароля, выход), NOTIF-04 (вид × канал), PRIV-02 (облачное согласие), PRIV-05 (архив), PRIV-06 (удаление аккаунта);
состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.identity.me` — email и `emailVerified`; `orpc.mail.status` — ссылка на локальный ящик.
- Изменение: `orpc.identity.resendVerification` — сразу, результат строкой («Письмо отправлено»), ошибка —
  `errors:<код>` с параметрами (`RATE_LIMITED` — «через N мин.»). Контекст ассистента: `staticData.page = "settings"`.
- Уведомления (`NotificationSettings`, NOTIF-04): `orpc.notifications.preferences` и `setPreference` — вид × сайт,
  сохраняется сразу; столбец Telegram неактивен до подключения бота (T-052, T-053).
- Пароль: `orpc.identity.changePassword` (форма — `ChangePasswordInput` + повтор; прочие сеансы завершаются).
- Сброс админом (AUTH-05, R37): `orpc.identity.adminResetNotice` — плашка «Пароль был сброшен администратором <дата>»,
  «Понятно» — `acknowledgeAdminReset`.
- Код: `orpc.identity.recoveryCodeStatus` («Кода пока нет» / «Код создан …»), `createRecoveryCode` — код показан один
  раз (`entities/recovery-code`), «Я сохранил(а) код» прячет его. Выход: `orpc.identity.signOut` → `queryClient.clear()`
  → `/login`.
- Конфиденциальность (`PrivacySettings`, PRIV-02): `orpc.privacy.state`; `setCloudConsent({ granted, version:
  CONSENT_VERSIONS.cloud })` — дать: окно с текстом `policy:cloud.warning` и отметкой «прочитал(а)»; отозвать — сразу.
- Мои данные (`MyDataSettings`): `orpc.privacy.dataExport`/`requestExport` (`none | pending | ready | failed`; готовый —
  ссылка `/api/files/<id>`, размер `formatFileSize`; «готовится» обновляет поток событий); `orpc.identity.deleteAccount`
  в `ConfirmDialog` (перечень + пароль, `INVALID_CREDENTIALS` — «Неверный пароль.») → `queryClient.clear()` → `/login`.

## Компоненты
Свои: `SettingsPage`, `EmailCard`, `PasswordCard`, `RecoveryCodeCard`, `SignOutCard`, `NotificationSettings`,
`PrivacySettings`, `MyDataSettings`. Из `entities`: `recovery-code`. Из `ui`: `PageHeader`, `StatusBadge`,
`EmptyState`, `SkeletonCard`, `ConfirmDialog`. Mantine: `Tabs`, `Button`, `Switch`, `Checkbox`, `Modal`, `Loader`.

## Переходы
«Открыть локальный ящик (демо)» → `/mailbox` (только пока почта не настроена и вход локальный).

## Отличия от макета (с причиной)
- Вкладки без Telegram (T-052, ARCHITECTURE §10.5); «Уведомления» без «Итогов недели» (T-050) и «Напоминаний
  календаря» (T-047).
- Отзыв облачного согласия — сразу, без окна «Перейти в локальный режим?» (одиночное действие — без подтверждения,
  frontend-feature.md; вернуть облако — тот же переключатель). В истории согласий — дата без времени (формата
  «чч:мм» в `@kosht/i18n` нет), версия текста — датой правки (`CONSENT_VERSIONS`), а не «1.2».
- Архив: вместо процента — «Готовим архив…» (сервер хода сборки не отдаёт); удаление — пароль без слова «УДАЛИТЬ»
  (PRIV-06 требует пароль) и без плашки демо-аккаунта (T-054).
- Вместо «Где вы вошли» (список сеансов) — карточка «Выход»: списка сеансов нет в контракте; смена пароля и так
  завершает другие сеансы.
- Подсказка пароля — «не короче 12» (SEC-01), а не «10» макета. Плашка «Пароль был сброшен администратором» — дата
  без «в 10:14» (формата времени суток нет).
- Колокольчик в шапке — T-015.

## Готово, когда
Тесты (`SettingsPage.test.tsx`, `PrivacySettings.test.tsx`, `MyDataSettings.test.tsx`) зелёные; `make e2e`
(`registration.spec.ts`, `notifications.spec.ts`, `my-data.spec.ts`) — axe 0 на 1440 и 390, без горизонтальной
прокрутки.
