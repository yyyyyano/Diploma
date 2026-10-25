# Экран `auth` — Вход

Маршрут: `/login` (`routes/_public/login.tsx`) · доступ: гость (вошедший уходит на `/`).

## Макет
- Исходник: `design/screens/Login.dc.html`; описание — `design/SCREENS.md` § «Вход».
- Скриншоты: `design/screenshots/desktop/Login.png`, `design/screenshots/mobile-width/Login.png`; состояние
  `design/screenshots/states/Login--wrong-password.png`.

## Требования SPEC
AUTH-08 (вход, выход), AUTH-10 (ссылка «Первый запуск»), NFR-24; состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Изменение: `orpc.identity.signIn` — форма на схеме `SignInInput`; cookie `kosht_session` ставит сервер; успех →
  `queryClient.clear()` и `/` (стартовый маршрут ведёт в раздел); ошибка — `errors:<код>` в `role="alert"`
  (`INVALID_CREDENTIALS` — «Неверный email или пароль…»).
- Чтение: `orpc.identity.status` — ссылка «Первый запуск», только пока `setupAvailable`.
- Адрес (`model/search.ts`): `created` — пришли с первого запуска. Контекст ассистента: `staticData.page = "login"`.

## Компоненты
Свои: `LoginPage` (панель бренда и форма). Из `ui`: `Logo`. Mantine: `TextInput`, `PasswordInput`, `Button`.

## Переходы
Успешный вход → `/` → раздел пользователя; «Первый запуск» → `/setup`.

## Отличия от макета (с причиной)
- Нет «Забыли пароль?», «Войти с кодом восстановления», демо-входа, регистрации и ссылок «База законов»,
  «Политика»: их экраны и процедуры — T-013, T-054, T-012, T-038; кусок экрана без модуля скрыт (ARCHITECTURE §10.5).
- Без счётчика «Осталось 3 попытки» и блокировки на 5 минут — частота попыток входа — T-013.
- Отступы панели бренда — ближайшие из шкалы `--s-*` (40 вместо 44/48).

## Готово, когда
Тесты (`LoginPage.test.tsx`) зелёные; `make e2e` (`first-run.spec.ts`) — axe 0 на 1440 и 390, без горизонтальной
прокрутки.
