# Модуль `privacy`

Ярус 1 · таблицы: user, system · публикует: `privacy.consent-changed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Согласия с версией текста (PRIV-01, PRIV-02), облачное согласие в настройках (дать и отозвать) и источник облачного
согласия для шлюза `llm`; экспорт и удаление аккаунта через реестр владельцев данных (PRIV-05/06). Текст политики и
согласий — словарь `policy` (`@kosht/i18n`), страница `/policy` — `features/auth`, вкладки настроек — `features/settings`.

## Требования SPEC
PRIV-01/02/05/06/08, AUTH-02.

## Публичный API (`index.ts`)
- Фабрика: `createPrivacyModule({ platform, facades })`; платформа — `SystemPlatform`; соседей нет (`NoFacades`).
- Фасад `PrivacyFacade`: `recordRegistrationConsents(tx, RegistrationConsents)` — в транзакции регистрации
  (identity): две строки журнала (ПД — дано, облако — как отмечено) с версией текста и моментом `Clock`, событие
  `privacy.consent-changed { ids }`, режим в `privacy_modes`; версия не совпала с `CONSENT_VERSIONS` словаря —
  `CONFLICT` (`reason: consent-version`), ничего не записано.
- Контракт `contract.privacy.*` (authed): `state` — облако разрешено ли и с какого момента, история решений (новые
  сверху, ≤ 200); `setCloudConsent({ granted, version })` — строка журнала, `privacy_modes` и событие одной
  транзакцией (`application/cloud-consent-settings.ts`); устаревшая версия — `CONFLICT`.
- Источник облачного согласия (`consentSource`, порт `ConsentSource`): последнее решение вида `cloud` пользователя
  scope, без кэша — отзыв действует на следующий вызов модели; решения нет — `false`.
- События (`events.ts`, экспорт из `index.ts`): `privacy.consent-changed { ids }` — id новых строк журнала.
- Таблица `privacy_consents` (`userOwnedTable`): `kind` (`personal-data | cloud`), `granted`, `text_version`,
  `created_at` — момент решения; строки только добавляются, действует последняя по виду. Владелец данных —
  `user-data.ts`.
- Таблица `privacy_modes` (`systemTable`): `user_id` → `cloud` (текущий режим для столбца «режим» админки, T-017);
  строки нет — локальный режим; удаляется с пользователем.

## Зависимости
Можно: — (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Строки журнала не правятся и не удаляются сценариями (кроме удаления аккаунта, T-016): новое решение — новая строка.
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(privacy_consents)`; «чьи данные» — только `s.scope`.
- Изменили текст политики или облачного согласия в словаре `policy` — поднимите версию в `CONSENT_VERSIONS`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/privacy` — журнал, событие, устаревшая версия, источник облачного
  согласия и чужое домохозяйство (`application/record-registration-consents.int.test.ts`), согласие в настройках и
  режим (`application/cloud-consent-settings.int.test.ts`); отзыв сквозь HTTP и цепочку llm —
  `main/cloud-consent.int.test.ts`.
