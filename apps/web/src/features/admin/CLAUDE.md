# Экран `admin` — Администрирование

Маршрут: `/admin` → `/admin/users`, `/admin/system`, `/admin/ai-requests?period=day|week|month`, `/admin/ai-providers`
(`routes/_app/admin.tsx` — каркас и проверка роли, `routes/_app/admin/{index,users,system,ai-requests,ai-providers}.tsx`) · доступ: админ (пункт меню «Администрирование» в группе «Профиль» —
только роли admin; не админу — «нет такой страницы», сервер отвечает `FORBIDDEN`).

## Макет
- Исходник: `design/screens/Admin.dc.html`; описание — `design/SCREENS.md` § «Администрирование».
- Скриншоты: `design/screenshots/desktop/Admin.png`, `design/screenshots/mobile-width/Admin.png`.
- Состояния: `design/screenshots/states/Admin--users.png`, `Admin--system.png`, `Admin--providers.png`,
  `Admin--ai-requests.png` (остальные вкладки — задачи своих модулей: законы, ставки, качество).

## Требования SPEC
ADM-01, ADM-20, ADM-21, ADM-22, ADM-30, ADM-50, ADM-60, LLM-08, LLM-09, NFR-16, AUTH-05, AUTH-12, R37, PRIV-07, NFR-23, NFR-24, OBS-05, OBS-07; состояния — DES-16;
доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.admin.users` (учётные записи, режим ИИ, «вы»), `orpc.admin.system` (задачи, почта, пояс, сеть,
  Langfuse). Контекст ассистента: `staticData.page = "admin" | "admin-users" | "admin-system"`.
- Изменение: `setUserStatus`, `setUserRole`, `resetUserPassword` — сразу, итог строкой (`LAST_ADMIN` — текст ошибки);
  `deleteUser` — `ConfirmDialog` с вводом email удаляемого; ссылка сброса без подтверждённой почты — окно с
  предупреждением о журнале (R37). ИИ: чтение — `orpc.admin.aiProviders` (провайдеры и статус ключей, реестр, цепочки),
  `orpc.admin.aiUsage({ period })`; изменение — `setAiChain` (вся цепочка в новом порядке), `setAiModelEnabled`,
  `saveAiModel`, `testAiProvider`, `setAiKey` (поле только для записи, после сохранения очищается), `setAiPrice` —
  ответ сервера кладётся в кэш. Числа считает сервер; сайт только записывает их (`ai-format.ts`: тысячи, миллионы,
  доллары, секунды, доли; цена в прайс-листе — доллары за миллион токенов ↔ микродоллары). `setMail` (пароль — только если введён), `sendTestMail`, `setTimeZone`, `setLan`
  — ответ — новая «Система» в кэш.

## Компоненты
Свои: `AdminLayout` (заголовок, плашка PRIV-07, вкладки-ссылки с `aria-current`), `AdminUsersPage`
(`DeleteUserDialog`, `ResetLinkDialog`), `AdminSystemPage` (`JobsCard`, `MailCard`, `TimeCard`), `AdminAiProvidersPage` (`ChainCard`, `KeysCard`, `RegistryCard`),
`AdminAiRequestsPage` (плитки на `StatCard`, `TasksCard`, `AnswersCard`, `PriceDialog`). Из `ui`: `PageHeader`,
`StatusBadge`, `ConfirmDialog`, `SkeletonList`, `SkeletonCard`. Mantine: `Menu`, `ActionIcon`, `Modal`, `TextInput`,
`NumberInput`, `PasswordInput`, `Select`, `Switch`, `Checkbox`, `Button`, `Anchor`.

## Переходы
Вкладки — ссылки `/admin/users`, `/admin/ai-requests`, `/admin/ai-providers`, `/admin/system`; период «Запросов к ИИ» — ссылки с `?period=`; «Открыть Langfuse» — адрес из `system.langfuse.url` (только этот компьютер).

## Отличия от макета (с причиной)
- Вкладки — ссылки, а не Tabs: у вкладки-маршрута нет панели на странице (aria-controls без панели — ошибка axe).
  Видны «Пользователи», «Запросы к ИИ», «Провайдеры ИИ» и «Система»; остальные — задачи своих модулей.
- «Запросы к ИИ»: период — «24 часа / 7 дней / 30 дней» (скользящие, как окна лимитов), а не «Сегодня»; таблицы
  «Последние запросы» с пользователями и шагами агента нет — журнал расхода хранит только служебное (OBS-04, ADM-22,
  PRIV-07), подробности — в Langfuse по ссылке. Условная стоимость считается по текущему прайсу.
- «Провайдеры ИИ»: нет блока «Локальные модели» со скачиванием (T-024) и ключа Gemini (SPEC LLM-02: только опционально,
  из Беларуси недоступен); включение — на уровне модели реестра (общее для всех её цепочек), а не строки цепочки.
- Telegram у всех «нет» и токена бота нет — T-052; «Пересоздать демо-данные» и «Режим разработки» — T-054.
- Время запуска задачи — днём («сегодня», «вчера», дата), без «чч:мм» и без столбца «Следующий»: формата времени
  суток в `@kosht/i18n` нет, а время следующего запуска pg-boss по cron наружу не отдаёт.
- На телефоне таблицы — строками-карточками (подпись столбца перед значением), без прокрутки внутри блока.

## Готово, когда
Тесты (`AdminUsersPage.test.tsx`, `AdminSystemPage.test.tsx`, `AdminAiProvidersPage.test.tsx`,
`AdminAiRequestsPage.test.tsx`, `ai-format.test.ts`) зелёные; `make e2e` (`first-run.spec.ts`) — axe 0 на
`/admin/users`, `/admin/ai-providers`, `/admin/ai-requests` (в том числе `?period=week`) и `/admin/system` при 1440 и 390, без горизонтальной прокрутки.
