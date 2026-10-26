// Шаблоны писем (AUTH-03, AUTH-04): тексты — из словаря mail (@kosht/i18n), ссылка — параметром. Ссылку строит
// модуль-отправитель (адрес по NFR-24), здесь проверяется только, что это http(s).
import type { T } from "@kosht/i18n";
import { isSafeLink, type MailMessage } from "../domain/message.ts";

/** Письмо по шаблону: вид и его параметры. */
export type MailTemplate = {
  readonly kind: "verify-email";
  readonly link: string;
  /** Сколько часов действует ссылка. */
  readonly hours: number;
};

export function composeMessage(t: T, to: string, template: MailTemplate): MailMessage {
  if (!isSafeLink(template.link)) throw new RangeError("Ссылка письма — только http или https.");
  return {
    to,
    subject: t("mail:verifyEmail.subject"),
    preview: t("mail:verifyEmail.preview"),
    title: t("mail:verifyEmail.title"),
    paragraphs: [
      t("mail:verifyEmail.greeting"),
      t("mail:verifyEmail.body"),
      t("mail:verifyEmail.usable"),
    ],
    action: { label: t("mail:verifyEmail.action"), url: template.link },
    note: { kind: "info", text: t("mail:verifyEmail.note", { hours: template.hours }) },
  };
}
