// Отправка письма (AUTH-06, ADR-0016): SMTP не настроен (пустой хост) — письмо в локальный ящик; настроен — по SMTP,
// а ящик выключен. Настройки читаются на каждое письмо: смена в админке действует без перезапуска. Сбой SMTP —
// UNAVAILABLE (повторяемая ошибка каталога); в лог — только ключ события и код ошибки, без адреса и текста (OBS-04).
import { createT, type T } from "@kosht/i18n";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import {
  MAIL_FROM,
  SMTP_HOST,
  SMTP_PASSWORD,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} from "../settings.ts";
import { composeMessage, type MailTemplate } from "./compose-message.ts";
import type { MailTransport, SmtpConfig } from "./ports.ts";

export interface SendMailDeps {
  readonly platform: Pick<Platform, "settings" | "secrets" | "log">;
  readonly mailbox: MailTransport;
  readonly smtp: (config: SmtpConfig) => MailTransport;
}

/** Настройки SMTP или undefined — почта не настроена, работает локальный ящик. */
export async function smtpConfig(
  d: Pick<Platform, "settings" | "secrets">,
  t: T,
): Promise<SmtpConfig | undefined> {
  const host = await d.settings.get(SMTP_HOST);
  if (host === "") return undefined;
  return {
    host,
    port: await d.settings.get(SMTP_PORT),
    secure: await d.settings.get(SMTP_SECURE),
    user: await d.settings.get(SMTP_USER),
    password: await d.secrets.reveal(SMTP_PASSWORD),
    from: { name: t("mail:from"), address: await d.settings.get(MAIL_FROM) },
  };
}

export function makeSendMail(d: SendMailDeps) {
  const t = createT();
  return async function sendMail(to: string, template: MailTemplate): Promise<void> {
    const message = composeMessage(t, to, template);
    const config = await smtpConfig(d.platform, t);
    if (config === undefined) {
      await d.mailbox.send(message);
      d.platform.log.info({ template: template.kind, transport: "mailbox" }, "mail.sent");
      return;
    }
    try {
      await d.smtp(config).send(message);
    } catch (error) {
      d.platform.log.warn({ template: template.kind, err: error }, "mail.send-failed");
      throw new AppError("UNAVAILABLE", {}, { cause: error });
    }
    d.platform.log.info({ template: template.kind, transport: "smtp" }, "mail.sent");
  };
}
