# Модуль `privacy`

Ярус 1 · таблицы: user, system · публикует: `privacy.consent-changed`, `privacy.export-ready` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Согласия с версией текста (PRIV-01, PRIV-02), облачное согласие в настройках (дать и отозвать) и источник облачного
согласия для шлюза `llm`; экспорт и удаление аккаунта через реестр владельцев данных (PRIV-05/06). Текст политики и
согласий — словарь `policy` (`@kosht/i18n`), страница `/policy` — `features/auth`, вкладки настроек — `features/settings`.

## Требования SPEC
PRIV-01/02/05/06/08, AUTH-02.

## Публичный API (`index.ts`)
- Фабрика: `createPrivacyModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `facades.files`
  (архив «Мои данные» — файл домохозяйства).
- Фасад `PrivacyFacade`: `recordRegistrationConsents(tx, RegistrationConsents)` — в транзакции регистрации
  (identity): две строки журнала (ПД — дано, облако — как отмечено) с версией текста и моментом `Clock`, событие
  `privacy.consent-changed { ids }`, режим в `privacy_modes`; версия не совпала с `CONSENT_VERSIONS` словаря —
  `CONFLICT` (`reason: consent-version`), ничего не записано.
- `purge(s)` (`application/purge-account.ts`, зовёт identity при удалении аккаунта): строки домохозяйства во всех
  таблицах реестра владельцев (`platform.userData()`, позднее связывание) одной транзакцией — модули в порядке,
  обратном `modules.ts`, таблицы — в порядке модуля; затем хуки `afterDelete` (файлы, системные строки, трассы).
- Архив «Мои данные» (`application/data-export.ts`, PRIV-05): заявка `pending` + задача `privacy.build-export` одной
  транзакцией (прежние архивы удаляются; готовящийся или две заявки разом — та же заявка; зависшая дольше
  `EXPORT_BUILD_SECONDS` — `failed`); задача пишет потоковый ZIP (`infrastructure/zip-archive.ts`, yazl, ADR-0012):
  `manifest.json`, `data/<модуль>/<таблица>.json` (страницы по 500), `files/<модуль>/<путь>` (хуки `export`) →
  `files.save` (вид `data-export`) → `ready` + `privacy.export-ready` + `realtime.changed(data-export)`; сбой — `failed`
  без файла. Скачивание — `files.download`. Фасад `isExportReady(s, id)` — для подписчика notifications;
  `cloudUsers()` — id пользователей в облачном режиме (столбец «Режим ИИ» админки, ADM-30).
- Контракт `contract.privacy.*` (authed): `dataExport` (`GET /privacy/export`) — последняя заявка
  (`none | pending | ready | failed`, файл `{ id, name, size }`); `requestExport` (`POST /privacy/export`); `state` —
  облако разрешено ли (по действующему тексту), с какого момента, `outdated` — согласие по прежнему тексту, история решений (новые сверху, ≤ 200); `setCloudConsent({ granted,
  version })` — строка журнала, `privacy_modes` и событие одной транзакцией (`cloud-consent-settings.ts`); устаревшая
  версия — `CONFLICT`.
- Источник облачного согласия (`consentSource`, порт `ConsentSource`): последнее решение вида `cloud` пользователя
  scope, без кэша — отзыв действует на следующий вызов модели; решения нет — `false`; согласие по прежнему тексту
  (`text_version` ≠ `CONSENT_VERSIONS.cloud`) не действует — «условия обновились» (T-023, R48).
- События (`events.ts`, экспорт из `index.ts`): `privacy.consent-changed { ids }` — id новых строк журнала;
  `privacy.export-ready { ids }` — готовые заявки архива.
- Таблица `privacy_consents` (`userOwnedTable`): `kind` (`personal-data | cloud`), `granted`, `text_version`,
  `created_at` — момент решения; строки только добавляются, действует последняя по виду (владелец — `user-data.ts`).
- Таблица `privacy_exports` (`userOwnedTable`): заявка на архив — `status` (`pending | ready | failed`), `file_id`
  (файл files без внешнего ключа), `file_name`, `size`, `finished_at`; одна `pending` на домохозяйство.
- Таблица `privacy_modes` (`systemTable`): `user_id` → `cloud` (текущий режим для столбца «режим» админки, T-017);
  строки нет — локальный режим; удаляет хук `afterDelete` владельца данных (`user-data.ts`).

## Зависимости
Можно: files (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Строки журнала не правятся и не удаляются сценариями (кроме удаления аккаунта): новое решение — новая строка.
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(privacy_consents)`; «чьи данные» — только `s.scope`.
- Изменили текст политики или облачного согласия в словаре `policy` — поднимите версию в `CONSENT_VERSIONS`: у всех,
  кто согласился по прежнему тексту, облако выключится до повторного согласия (миграция сбрасывает и `privacy_modes`).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/privacy` — журнал, событие, устаревшая версия, источник облачного
  согласия и чужое домохозяйство (`application/record-registration-consents.int.test.ts`), согласие в настройках и
  режим (`application/cloud-consent-settings.int.test.ts`); отзыв сквозь HTTP и цепочку llm —
  `main/cloud-consent.int.test.ts`; удаление аккаунта целиком — `main/account-deletion.int.test.ts`; архив —
  `application/data-export.int.test.ts` (состав, страницы, повторы, гонка заявок, сбой) и сквозь HTTP и worker с
  полнотой выгрузки по `userOwnedTable` — `main/data-export.int.test.ts`; ZIP — `infrastructure/zip-archive.test.ts`.
