# Модуль `mail`

Ярус 1 · таблицы: system · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Письма системы: SMTP (Nodemailer) или встроенный локальный почтовый ящик, пока SMTP не настроен (ADR-0016). Поля SMTP
в админке и «Отправить тестовое письмо» — T-017.

## Требования SPEC
AUTH-03/04/06, ADM-60, NFR-24 (ящик — только локальный вход).

## Публичный API (`index.ts`)
- Фабрика: `createMailModule({ platform, facades })`; платформа — `SystemPlatform`; соседей нет (`NoFacades`).
- Фасад `MailFacade`: `send(to, template)` — письмо по шаблону (`MailTemplate`: `verify-email { link, hours }`,
  `reset-password { link, minutes }`);
  тексты — словарь `mail` (`@kosht/i18n`), ссылка — только http(s) (иначе `RangeError`); сбой SMTP — `UNAVAILABLE`.
- Контракт `contract.mail.*`: `status` (publicProc: `{ mailboxAvailable }` — вход локальный и SMTP не настроен),
  `mailbox` (localOnly: на `lan` — `NOT_FOUND`; `{ enabled, messages }` — до 100 последних писем, новые сверху; SMTP
  настроен — `enabled: false`, писем нет).
- Настройки (`settings.ts`): `mail.smtp-host` (пусто — почта не настроена; env `SMTP_HOST`), `mail.smtp-port` (587,
  `SMTP_PORT`), `mail.smtp-secure` (`SMTP_SECURE`), `mail.smtp-user` (`SMTP_USER`), `mail.from-address`
  (`no-reply@kosht.local`, `SMTP_FROM`); секрет `mail.smtp-password` (`SMTP_PASSWORD`). Читаются на каждое письмо.
- Таблица `mail_messages` (`systemTable`): получатель и готовые поля письма (`domain/message.ts`), без HTML.

## Зависимости
Можно: — (`tooling/architecture/modules.ts`). Слушает: —. `nodemailer` — только `infrastructure/` (правило
`nodemailer-only-in-mail-infrastructure`); `application/` видит порт `MailTransport` (`application/ports.ts`).

## Запреты
- Адрес, тема и ссылка письма — не в логах: только `mail.sent` / `mail.send-failed` с шаблоном и транспортом.
- HTML письма — только `renderHtml` (экранирует каждое значение); страница ящика рисует поля сама, без вставки HTML.
- Ящик — только `localOnly`; при настроенном SMTP письма в ящик не пишутся и не показываются.
- `SystemDb` — только для `mail_messages`; пользовательские таблицы не трогать.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/mail`: части письма и экранирование (`domain/message.test.ts`), оба режима
  на Postgres и поддельном SMTP на 127.0.0.1 (`application/send-mail.int.test.ts`,
  `infrastructure/__fixtures__/fake-smtp.ts`), доступ к ящику по слушателю (`api/router.test.ts`).

## Подводные камни
- Одно письмо — одно соединение SMTP со сроками 10/10/20 с (`SMTP_TIMEOUTS`): настройки меняются в админке, писем мало.
- Тело письма по SMTP — в base64: тест раскодирует части (`decodedParts`), а не ищет ссылку в сыром тексте.
