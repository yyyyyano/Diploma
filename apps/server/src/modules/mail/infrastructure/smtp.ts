// SMTP через Nodemailer (ADR-0016): одно письмо — одно соединение (писем мало, настройки могут смениться в админке).
// Сроки соединения короткие: недоступный сервер не держит запрос регистрации минутами.
import { createTransport } from "nodemailer";
import { renderHtml, renderText } from "../domain/message.ts";
import type { MailTransport, SmtpConfig } from "../application/ports.ts";

export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

export function createSmtpTransport(config: SmtpConfig): MailTransport {
  return {
    async send(message) {
      const transporter = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user === "" ? {} : { auth: { user: config.user, pass: config.password ?? "" } }),
        ...SMTP_TIMEOUTS,
      });
      try {
        await transporter.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: renderText(message),
          html: renderHtml(message),
        });
      } finally {
        transporter.close();
      }
    },
  };
}
