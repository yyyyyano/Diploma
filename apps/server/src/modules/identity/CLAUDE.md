# Модуль `identity`

Ярус 1 · таблицы: system · публикует: `identity.system-initialized`, `identity.user-registered`, `identity.user-deleted` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Вход: Better Auth (только ядро, ADR-0016) — пароль и сессии; первый запуск; регистрация с согласиями и подтверждение
адреса; сброс пароля, код восстановления, блокировка и защита последнего администратора; источник сессий сайта и
перепроверка владельцев задач. Экраны админки — T-017; демо-вход — T-054.

## Требования SPEC
AUTH-01…12, ROLE-01/02, SEC-01/02, ADM-01, ADM-30, DEMO-04. Сделано: AUTH-01…05 (без Telegram и админки), AUTH-08,
AUTH-10…12, ROLE-02, SEC-01/02, PRIV-06 (удаление своего аккаунта). Макет: `Setup`, `Login`, `Register`,
`Settings` (сайт — `features/{setup,auth,settings}`).

## Публичный API (`index.ts`)
- Фабрика: `createIdentityModule({ platform, facades })`; `SystemPlatform`; фасады `mail` (письма), `privacy` (согласия).
- Фасад `IdentityFacade` (`application/admins.ts`): `setStatus(userId, active|blocked)` (блокировка завершает сессии),
  `setRole(userId, user|admin)`, `assertRemovable(db транзакции удаления, userId)`; последнего активного админа —
  `LAST_ADMIN` (под `FOR UPDATE` активных админов: параллельные снятия роли друг с друга оставляют одного).
- `contract.identity.*` — publicProc: `status`, `signIn` (частота на email; неверно — `INVALID_CREDENTIALS`;
  заблокирован при верном пароле — `ACCOUNT_BLOCKED` без cookie), `register` (частота на email и на всех; занятый —
  `EMAIL_TAKEN`; пользователь, согласия, ссылка и `identity.user-registered` одной транзакцией → письмо → вход),
  `verifyEmail` (POST со страницы `/verify-email`), `requestPasswordReset` (ответ одинаковый для любого email; письмо —
  активному), `resetPassword` (ссылка `/recovery?token=…`, 1 ч; новый пароль завершает сессии; заблокированный после выдачи
  ссылки — `ACCOUNT_BLOCKED`), `recoverWithCode` (новый пароль, новый код, вход; неизвестный email — ложный хэш, то же
  время; код гасится `DELETE … WHERE code_hash` в транзакции — из двух параллельных проходит один), `signOut`; localOnly: `setup`
  (код восстановления в ответе); authed: `me` (+ `emailVerified`), `resendVerification`, `recoveryCodeStatus`,
  `createRecoveryCode`, `changePassword` (Better Auth: прочие сессии завершены, новая cookie), `deleteAccount`
  (PRIV-06, `application/delete-account.ts`: пароль → блокировка и сессии (LAST_ADMIN под блокировкой админов) →
  `jobs.discardHousehold` → `privacy.purge` → `mail.forgetRecipient` → последней запись identity; cookie снята).
- Ссылки в письмах — адрес по `platform/http/link-origin.ts` (NFR-24); токен 32 байта base64url, в
  `identity_verifications` — SHA-256 (`<назначение>:<хэш>` → id пользователя), гасится `DELETE … RETURNING`, срок —
  по `Clock`; новая ссылка гасит прежнюю того же назначения.
- Код восстановления (`domain/recovery-code.ts`): 16 знаков Crockford base32 «XXXX-XXXX-XXXX-XXXX», в
  `identity_recovery_codes` — хэш argon2id; сверка — `verifyPassword` (постоянное время).
- Настройки (`settings.ts`): `identity.verify-link-hours` (24), `identity.reset-link-minutes` (60); частота
  `{ limit, windowMinutes }`: `rate-sign-in` (5/15), `rate-password-reset` (3/60), `rate-recovery-code` (5/15),
  `rate-register` (3/60), `rate-register-total` (30/60), `rate-resend-verification` (3/60) — ключ email или id.
- События: `identity.system-initialized`, `identity.user-registered` (`{ ids }`; слушает `accounts`). Реестры:
  `sessionSource` (только активный; продлённая сессия — с новой cookie) и `scopeVerifier`.
- Таблицы (`systemTable`): `identity_users` (+ `role`, `status`, `demo`, `household_id`), `identity_sessions`,
  `identity_credentials`, `identity_verifications`, `identity_recovery_codes`, `identity_households`, `system_state`.

## Зависимости
Можно: mail, privacy (`tooling/architecture/modules.ts`). Слушает: —. `better-auth` — только `infrastructure/`; `application/` видит порт `AuthGateway`.

## Запреты
- `auth.handler` Better Auth не монтировать: процедуры oRPC зовут `auth.api.*`; регистрация, ссылки и код — свои
  сценарии (`disableSignUp`), плагинов нет (`admin` нарушает PRIV-07, R37).
- Пароль, cookie, токены, код восстановления и email — не в логах и не в ответах (кроме `Set-Cookie` и кода — один раз).
- Scope нового пользователя — только `application/new-user-scope.ts`; `SystemDb` — только свои таблицы.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/identity` — пароль, код, Better Auth (блокировка, продление cookie, смена
  пароля), первый запуск, ссылки, сброс (`FakeClock`), код восстановления, последний админ и гонка (`admins.int.test.ts`).
- Сквозь HTTP — `main/{registration,recovery,first-run,account-deletion}.int.test.ts` (стенд `http-stack.ts`).

## Подводные камни
- Пользователь пишется через `tx.db` ScopedDb нового пользователя: аудитор в scoped проверяет только пользовательские
  таблицы. Срок ссылок — свой (`Clock`), а не Better Auth (тот сверяет `new Date()`, FakeClock на него не действует).
- `name` пользователя пуст (экраны имени не спрашивают) — сайт показывает email.
