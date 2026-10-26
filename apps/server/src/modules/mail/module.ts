// Модуль mail (паспорт — CLAUDE.md): письма системы — SMTP (Nodemailer) или локальный почтовый ящик, пока SMTP не
// настроен (AUTH-06, ADR-0016). Соседям — фасад send(to, шаблон); тексты писем — словарь mail.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import { mailRouter } from "./api/router.ts";
import { makeMailbox, makeMailboxEnabled } from "./application/mailbox.ts";
import { makeSendMail } from "./application/send-mail.ts";
import { createLocalMailbox } from "./infrastructure/local-mailbox.ts";
import { createSmtpTransport } from "./infrastructure/smtp.ts";
import {
  MAIL_FROM,
  SMTP_HOST,
  SMTP_PASSWORD,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type MailFacades = NoFacades;

export function createMailModule({ platform }: ModuleDeps<MailFacades, SystemPlatform>) {
  const send = makeSendMail({
    platform,
    mailbox: createLocalMailbox(platform),
    smtp: createSmtpTransport,
  });
  return defineModule({
    id: "mail",
    facade: { send },
    router: mailRouter({
      mailbox: makeMailbox(platform),
      mailboxEnabled: makeMailboxEnabled(platform),
    }),
    settings: [SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, MAIL_FROM],
    secrets: [SMTP_PASSWORD],
  });
}

/** Что модуль даёт соседям: send(to, шаблон) — письмо по SMTP или в локальный ящик. */
export type MailFacade = ReturnType<typeof createMailModule>["facade"];
