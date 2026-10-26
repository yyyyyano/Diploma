# Экран `auth` — Вход, регистрация, подтверждение адреса, политика

Маршруты (`routes/_public/`): `/login`, `/register` (гость; вошедший уходит на `/`), `/verify-email?token=…`,
`/recovery` (`?token=…` — новый пароль, `?mode=code` — вход с кодом), `/policy` (все). Общий каркас — `AuthLayout` (панель бренда и колонка формы; стили — `AuthLayout.module.css`).

## Макет
- Исходник: `design/screens/Login.dc.html`, `Register.dc.html`; описание — `design/SCREENS.md` § «Вход»,
  «Регистрация и согласия». Макетов `/verify-email` и `/policy` нет — в стиле Register/Login (DES-00).
- Скриншоты: `design/screenshots/desktop/Login.png`, `design/screenshots/mobile-width/Login.png`; состояние
  `design/screenshots/states/Login--wrong-password.png`.

## Требования SPEC
AUTH-01…05 (регистрация, письмо, подтверждение, сброс, код восстановления), AUTH-08 (вход), AUTH-11, AUTH-10 (ссылка «Первый запуск»), PRIV-01,
PRIV-02 (согласия, политика), SEC-01 (пароль ≥ 12), NFR-24; состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Изменение: `orpc.identity.signIn` — форма на схеме `SignInInput`; cookie `kosht_session` ставит сервер; успех →
  `queryClient.clear()` и `/` (стартовый маршрут ведёт в раздел); ошибка — `errors:<код>` в `role="alert"`
  (`INVALID_CREDENTIALS` — «Неверный email или пароль…»).
- Чтение: `orpc.identity.status` — ссылка «Первый запуск», только пока `setupAvailable`.
- Адрес (`model/search.ts`): `created` — пришли с первого запуска. Контекст ассистента: `staticData.page = "login"`.
- Регистрация: `orpc.identity.register` — форма `model/register-form.ts` (поля на схемах контракта, согласие на ПД —
  literal true), в запрос — версии текстов согласий `CONSENT_VERSIONS` (`@kosht/i18n`); подсказка надёжности —
  `model/password-strength.ts` (своя эвристика: ≥ 12, буквы и цифры, не email); успех — `queryClient.clear()`,
  «Аккаунт создан», ссылка на ящик по `orpc.mail.status`. Ошибки — `errors:<код>` с параметрами (`errorParamsOf`).
- Подтверждение: `/verify-email` (`model/verify-search.ts`: `token`) шлёт `orpc.identity.verifyEmail` один раз.
- Восстановление (`RecoveryPage`, `model/recovery-search.ts`, формы — `model/recovery-forms.ts`):
  `orpc.identity.requestPasswordReset` («Проверьте почту», ссылка на ящик), `resetPassword` (`LINK_INVALID` —
  «Запросить новую ссылку»), `recoverWithCode` (`queryClient.clear()`, новый код — `entities/recovery-code`, «Перейти в
  Кошт» после «сохранил»). Вход: `ACCOUNT_BLOCKED` и `RATE_LIMITED` — заголовок и текст с минутами.
- Политика: тексты — словарь `policy`; версия — `CONSENT_VERSIONS.personalData`; закон № 99-З — ссылка на pravo.by.

## Компоненты
Свои: `AuthLayout`, `LoginPage`, `RegisterPage`, `VerifyEmailPage`, `RecoveryPage`, `PolicyPage`. Из `entities`:
`recovery-code`. Из `ui`: `Logo`. Mantine: `TextInput`,
`PasswordInput`, `Checkbox`, `Badge`, `Button`.

## Переходы
Успешный вход → `/` → раздел пользователя; «Первый запуск» → `/setup`; «Зарегистрироваться» ↔ «Войти»; «политикой»
→ `/policy` (в новой вкладке — форма не теряется); «Аккаунт создан» → «Продолжить» (`/`) или `/mailbox`.

## Отличия от макета (с причиной)
- «Забыли пароль?» и вход с кодом — отдельная страница `/recovery`, а не состояния окна входа (адрес — состояние).
- Нет демо-входа и ссылки «База законов» (T-054, T-038); в «Нет доступа к почте?» нет Telegram и администратора
  (T-052/T-053, T-017).
- Пароль на регистрации — от 12 символов (SEC-01), а не «от 8» макета; политика — страница `/policy`, а не окно.
- После «Аккаунт создан» — «Продолжить» на главную: анкеты на 1 минуту ещё нет (T-018).
- Без счётчика «Осталось 3 попытки» и неактивной кнопки «Войти можно через 5 минут»: частота — на сервере, сверх
  порога — текст «Попробуйте через N мин.».
- Отступы панели бренда — ближайшие из шкалы `--s-*` (40 вместо 44/48).

## Готово, когда
Тесты (`*.test.tsx`, `model/*.test.ts`) зелёные; `make e2e` (`first-run.spec.ts`, `registration.spec.ts`, `recovery.spec.ts`) — axe 0 на
1440 и 390, без горизонтальной прокрутки.
