# Экран `admin` — Администрирование

Маршрут: `/admin` → `/admin/laws`, `/admin/rates`, `/admin/users`, `/admin/system`, `/admin/ai-requests?period=day|week|month`, `/admin/ai-providers`
(`routes/_app/admin.tsx` — каркас и проверка роли, `routes/_app/admin/{index,laws,rates,users,system,ai-requests,ai-providers}.tsx`) · доступ: админ (пункт меню «Администрирование» в группе «Профиль» —
только роли admin; не админу — «нет такой страницы», сервер отвечает `FORBIDDEN`).

## Макет
- Исходник: `design/screens/Admin.dc.html`; описание — `design/SCREENS.md` § «Администрирование».
- Скриншоты: `design/screenshots/desktop/Admin.png`, `design/screenshots/mobile-width/Admin.png`.
- Состояния: `design/screenshots/states/Admin--users.png`, `Admin--system.png`, `Admin--providers.png`,
  `Admin--ai-requests.png`, `Admin--index-building.png` («Законы»), `Admin--rates.png` («Таблица ставок»); остальные вкладки — задачи своих модулей: ставки, качество.

## Требования SPEC
ADM-01, ADM-10, ADM-11, TAX-03, LAW-33, LAW-16, LAW-36, LAW-40, ADM-20, ADM-21, ADM-22, ADM-30, ADM-50, ADM-60, LLM-08, LLM-09, NFR-16, AUTH-05, AUTH-12, R37, PRIV-07, NFR-23, NFR-24, OBS-05, OBS-07; состояния — DES-16;
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

- «Законы» (T-039): чтение — `orpc.admin.lawsOverview` (опрос раз в 2 с, пока грузится стартовый каталог или строятся векторы), `lawsActs({ status?, page })`,
  `lawsCandidates`, `lawsUpdates`, `lawsFetches`, `lawsDictionary({ kind })`; изменение — `setLawsSettings` (время, окно, автообновление, режим новых актов, контакт;
  ошибка окна — `VALIDATION` с полем), `lawsCheckNow`, `addLawActs`, `lawsCheckText`, `excludeLawAct` (`ConfirmDialog`), `decideLawCandidate`,
  `lawsDictionaryUpsert/Remove`. Время приходит готовым (`LawMoment`: день и «ЧЧ:ММ» по поясу системы); сайт ничего не считает и не форматирует суммы.

- «Таблица ставок» (T-040): чтение — `orpc.admin.rates` (все версии: подтверждённые, ожидающие, вытесненные); изменение — `proposeRate` (значение читается `parseMoney`: «216,50» → 21650 копеек,
  проценты «13,5» → 1350; на сервер уходит целое), `confirmRate`, `rejectRate` — ответ (вся таблица) кладётся в кэш. Словарь страницы — `ratesTexts` из `@kosht/i18n`, не входит в
  `resources`: страница регистрирует его при показе (бюджет первой загрузки).

## Компоненты
Свои: `AdminLayout` (заголовок, плашка PRIV-07, вкладки-ссылки с `aria-current`), `AdminUsersPage`
(`DeleteUserDialog`, `ResetLinkDialog`), `AdminSystemPage` (`JobsCard`, `MailCard`, `TimeCard`), `AdminAiProvidersPage` (`ChainCard`, `KeysCard`, `RegistryCard`),
`AdminAiRequestsPage` (плитки на `StatCard`, `TasksCard`, `AnswersCard`, `PriceDialog`), `AdminLawsPage` (плитки, `ScheduleCard`, `LoaderCard`, `AddActsDialog`; отдельным
чанком — `lazyPage`), `AdminRatesPage` (`RateLine`, `History`, `ProposeDialog`; чанком, со своим словарём), `LawsSections` (акты, очередь, журналы) и один общий `DictionaryEditor` на семь справочников (поля и варианты — из ответа сервера). Из `ui`: `PageHeader`,
`StatusBadge`, `ConfirmDialog`, `SkeletonList`, `SkeletonCard`. Mantine: `Menu`, `ActionIcon`, `Modal`, `TextInput`,
`NumberInput`, `PasswordInput`, `Select`, `Switch`, `Checkbox`, `Button`, `Anchor`.

## Переходы
Вкладки — ссылки `/admin/laws`, `/admin/rates`, `/admin/users`, `/admin/ai-requests`, `/admin/ai-providers`, `/admin/system`; период «Запросов к ИИ» — ссылки с `?period=`; «Открыть Langfuse» — адрес из `system.langfuse.url` (только этот компьютер).

## Отличия от макета (с причиной)
- Вкладки — ссылки, а не Tabs: у вкладки-маршрута нет панели на странице (aria-controls без панели — ошибка axe).
  Видны «Законы», «Таблица ставок», «Пользователи», «Запросы к ИИ», «Провайдеры ИИ» и «Система»; остальные — задачи своих модулей.
- «Законы»: разделы «Акты / Очередь кандидатов / Журнал обновлений / Запросы загрузчика / Справочники» — кнопки с `aria-pressed` в одной панели (адресов у разделов нет);
  к шести состояниям макета добавлено седьмое — «Ждёт загрузки» (акт заведён, текст ещё не загружен); «Сравнить снимки» и «Повторить» макета нет (карантин и ошибка
  лечатся сами со следующей проверкой), у акта-карточки — «Проверить текст», у любого — «Исключить»; журнал обновлений — событие словами и название акта (без «изменены ст. 209, 211»:
  подробностей по статьям в журнале нет); время проверки и окно — поля времени, а не часы со стрелкой; демо-цифры макета в код не перенесены.
- «Таблица ставок»: нет колонки «ред. 01.07.2026» (версия фрагмента привязывается, когда акт проиндексирован, и сайту не отдаётся — только отметка «привязана»); «Открыть фрагмент» в пометке
  расхождения — нет (читалка по пункту — T-043); у вытесненных значений — только строка истории; вместо строки «Нет значения / Добавить» — общая кнопка «Добавить значение».
- «Запросы к ИИ»: период — «24 часа / 7 дней / 30 дней» (скользящие, как окна лимитов), а не «Сегодня»; таблицы
  «Последние запросы» с пользователями и шагами агента нет — журнал расхода хранит только служебное (OBS-04, ADM-22,
  PRIV-07), подробности — в Langfuse по ссылке. Условная стоимость считается по текущему прайсу.
- «Провайдеры ИИ»: блок «Локальные модели» — по четырём моделям каталога (чат, эмбеддинги, речь, NER) с полосой прогресса,
  опрос раз в 2 с, «Скачать»/«Повторить», «Проверить модели»; выбора варианта модели («2B/9B») и «Пауза» макета нет; ключа Gemini (SPEC LLM-02: только опционально,
  из Беларуси недоступен); включение — на уровне модели реестра (общее для всех её цепочек), а не строки цепочки.
- Telegram у всех «нет» и токена бота нет — T-052; «Пересоздать демо-данные» и «Режим разработки» — T-054.
- Время запуска задачи — днём («сегодня», «вчера», дата), без «чч:мм» и без столбца «Следующий»: формата времени
  суток в `@kosht/i18n` нет, а время следующего запуска pg-boss по cron наружу не отдаёт.
- На телефоне таблицы — строками-карточками (подпись столбца перед значением), без прокрутки внутри блока.

## Готово, когда
Тесты (`AdminLawsPage.test.tsx`, `AdminRatesPage.test.tsx`, `AdminUsersPage.test.tsx`, `AdminSystemPage.test.tsx`, `AdminAiProvidersPage.test.tsx`,
`AdminAiRequestsPage.test.tsx`, `ai-format.test.ts`) зелёные; `make e2e` (`first-run.spec.ts`) — axe 0 на
`/admin/laws`, `/admin/rates`, `/admin/users`, `/admin/ai-providers`, `/admin/ai-requests` (в том числе `?period=week`) и `/admin/system` при 1440 и 390, без горизонтальной прокрутки.
