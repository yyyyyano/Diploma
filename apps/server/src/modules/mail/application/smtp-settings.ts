// Почта в админке (ADM-60, AUTH-06, NFR-16): поля SMTP — настройки модуля, пароль — секрет только для записи
// (наружу — «задан / не задан»). Пустой хост — почта не настроена, письма идут в локальный ящик. Сохранение действует
// без перезапуска: настройки читаются на каждое письмо. Тестовое письмо — на адрес администратора, сбой — UNAVAILABLE.
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { SettingDef } from "../../../platform/settings/settings.ts";
import {
  MAIL_FROM,
  SMTP_HOST,
  SMTP_PASSWORD,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} from "../settings.ts";
import type { makeSendMail } from "./send-mail.ts";

export interface SmtpView {
  readonly configured: boolean;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly from: string;
  readonly passwordSet: boolean;
}

export interface SmtpInput {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly from: string;
  /** Новый пароль; не передан — прежний остаётся. */
  readonly password?: string | undefined;
}

export function makeSmtpSettings(
  d: Pick<Platform, "settings" | "secrets" | "log"> & {
    readonly send: ReturnType<typeof makeSendMail>;
  },
) {
  async function view(): Promise<SmtpView> {
    const host = await d.settings.get(SMTP_HOST);
    return {
      configured: host !== "",
      host,
      port: await d.settings.get(SMTP_PORT),
      secure: await d.settings.get(SMTP_SECURE),
      user: await d.settings.get(SMTP_USER),
      from: await d.settings.get(MAIL_FROM),
      passwordSet: (await d.secrets.status(SMTP_PASSWORD)) === "set",
    };
  }

  /** Сохранить всё сразу: сначала все поля сверяются со схемами настроек — неверное поле не оставит половину. */
  async function save(input: SmtpInput): Promise<void> {
    const fields: readonly [SettingDef<unknown>, unknown][] = [
      [SMTP_HOST, input.host],
      [SMTP_PORT, input.port],
      [SMTP_SECURE, input.secure],
      [SMTP_USER, input.user],
      [MAIL_FROM, input.from],
    ];
    for (const [def, value] of fields) {
      if (!def.schema.safeParse(value).success)
        throw new AppError("VALIDATION", { setting: def.key });
    }
    for (const [def, value] of fields) await d.settings.set(def, value);
    if (input.password !== undefined) await d.secrets.set(SMTP_PASSWORD, input.password);
    d.log.info({ transport: input.host === "" ? "mailbox" : "smtp" }, "mail.smtp-saved");
  }

  async function sendTest(to: string): Promise<void> {
    await d.send(to, { kind: "test" });
  }

  return { view, save, sendTest };
}
