# Модуль `admin`

Ярус 4 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Раздел «Администрирование»: процедуры `contract.admin.*` поверх admin-фасадов модулей; своих данных нет (PRIV-07).
Сделано: «Пользователи» (ADM-30) и «Система» (ADM-60); остальные вкладки — задачи своих модулей.

## Требования SPEC
ADM-01…60 (экраны).

## Публичный API (`index.ts`)
- Фабрика: `createAdminModule({ platform, facades })` → `defineModule({ id: "admin" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.identity`, `facades.privacy`, `facades.notifications`, `facades.mail`, `facades.llm`,
  `facades.legalBase`, `facades.normTables`, `facades.system`, `facades.quality`, `facades.demo`.
- Фасад `AdminFacade` — нет (`undefined`): админку соседи не зовут.
- Контракт `contract.admin.*` (`api/router.ts`, все — `admin`: сессия и роль, не админу — `FORBIDDEN`):
  `users` — учётные записи identity + флаг облачного режима privacy + «вы» (`application/admin-users.ts`; Telegram —
  `false` до T-052); `setUserStatus`, `setUserRole` (последний админ — `LAST_ADMIN`), `deleteUser({ id, email })`,
  `resetUserPassword({ id })` — фасады identity; `system` — `system.view()` + `mail.smtp.view()`; `setMail`,
  `sendTestMail` (на адрес вошедшего администратора), `setTimeZone`, `setLan` — отвечают обновлённой «Системой».
  Форма ответов — только метаданные (`packages/contract/src/admin/admin.contract.test.ts`).

## Зависимости
Можно: identity, privacy, notifications, mail, llm, legal-base, norm-tables, system, quality, demo (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей.
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- Сквозь HTTP и корень композиции — `main/admin.int.test.ts` (роли, список, блокировка и последний админ, удаление с
  email, сброс пароля письмом и ссылкой, «Система»); форма DTO — `admin.contract.test.ts`.
