// Внешний мир модуля mail (ARCHITECTURE §4.4): куда уходит письмо — SMTP или локальный ящик.
import type { MailMessage } from "../domain/message.ts";

/** Доставка готового письма; сбой доставки — исключение. */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

/** Подключение SMTP из настроек (пароль — из секретов). */
export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string | undefined;
  readonly from: { readonly name: string; readonly address: string };
}
