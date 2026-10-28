# Экран `admin` — Администрирование

Маршрут: `/admin` → `/admin/users`, `/admin/system` (`routes/_app/admin.tsx` — каркас и проверка роли,
`routes/_app/admin/{index,users,system}.tsx`) · доступ: админ (пункт меню «Администрирование» в группе «Профиль» —
только роли admin; не админу — «нет такой страницы», сервер отвечает `FORBIDDEN`).

## Макет
- Исходник: `design/screens/Admin.dc.html`; описание — `design/SCREENS.md` § «Администрирование».
- Скриншоты: `design/screenshots/desktop/Admin.png`, `design/screenshots/mobile-width/Admin.png`.
- Состояния: `design/screenshots/states/Admin--users.png`, `Admin--system.png` (остальные вкладки — задачи своих
  модулей: законы, ставки, запросы к ИИ, качество, провайдеры).

## Требования SPEC
ADM-01, ADM-30, ADM-60, AUTH-05, AUTH-12, R37, PRIV-07, NFR-23, NFR-24, OBS-05, OBS-07; состояния — DES-16;
доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.admin.users` (учётные записи, режим ИИ, «вы»), `orpc.admin.system` (задачи, почта, пояс, сеть,
  Langfuse). Контекст ассистента: `staticData.page = "admin" | "admin-users" | "admin-system"`.
- Изменение: `setUserStatus`, `setUserRole`, `resetUserPassword` — сразу, итог строкой (`LAST_ADMIN` — текст ошибки);
  `deleteUser` — `ConfirmDialog` с вводом email удаляемого; ссылка сброса без подтверждённой почты — окно с
  предупреждением о журнале (R37). `setMail` (пароль — только если введён), `sendTestMail`, `setTimeZone`, `setLan`
  — ответ — новая «Система» в кэш.

## Компоненты
Свои: `AdminLayout` (заголовок, плашка PRIV-07, вкладки-ссылки с `aria-current`), `AdminUsersPage`
(`DeleteUserDialog`, `ResetLinkDialog`), `AdminSystemPage` (`JobsCard`, `MailCard`, `TimeCard`). Из `ui`: `PageHeader`,
`StatusBadge`, `ConfirmDialog`, `SkeletonList`, `SkeletonCard`. Mantine: `Menu`, `ActionIcon`, `Modal`, `TextInput`,
`NumberInput`, `PasswordInput`, `Select`, `Switch`, `Checkbox`, `Button`, `Anchor`.

## Переходы
Вкладки — `/admin/users` ↔ `/admin/system`; «Открыть Langfuse» — адрес из `system.langfuse.url` (только этот компьютер).

## Отличия от макета (с причиной)
- Вкладки — ссылки, а не Tabs: у вкладки-маршрута нет панели на странице (aria-controls без панели — ошибка axe).
  Видны только «Пользователи» и «Система»; остальные — задачи своих модулей.
- Telegram у всех «нет» и токена бота нет — T-052; «Пересоздать демо-данные» и «Режим разработки» — T-054.
- Время запуска задачи — днём («сегодня», «вчера», дата), без «чч:мм» и без столбца «Следующий»: формата времени
  суток в `@kosht/i18n` нет, а время следующего запуска pg-boss по cron наружу не отдаёт.
- На телефоне таблицы — строками-карточками (подпись столбца перед значением), без прокрутки внутри блока.

## Готово, когда
Тесты (`AdminUsersPage.test.tsx`, `AdminSystemPage.test.tsx`) зелёные; `make e2e` (`first-run.spec.ts`) — axe 0 на
`/admin/users` и `/admin/system` при 1440 и 390, без горизонтальной прокрутки.
