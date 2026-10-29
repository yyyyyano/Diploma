// Подтверждение адреса (AUTH-03): ссылка «<адрес сайта>/verify-email?token=…» ведёт на страницу сайта, а та шлёт
// POST identity.verifyEmail — GET со сменой состояния сработал бы от предпросмотра ссылки почтовиком. Ссылка
// одноразовая, срок — настройка identity.verify-link-hours; адрес сайта — по настройкам, не по запросу (NFR-24).
import type { UserId } from "@kosht/kernel";
import { AppError } from "../../../platform/errors/app-error.ts";
import { resolveLinkOrigin } from "../../../platform/http/link-origin.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { MailFacade } from "../../mail/index.ts";
import { markEmailVerified, type IdentityDb } from "../infrastructure/db/identity.repo.ts";
import { consumeLinkToken, saveLinkToken } from "../infrastructure/db/link-tokens.repo.ts";
import { linkTokenHash, newLinkToken } from "../infrastructure/link-token.ts";
import { VERIFY_LINK_HOURS } from "../settings.ts";

export interface EmailVerificationDeps {
  readonly platform: Pick<SystemPlatform, "system" | "settings" | "clock" | "log" | "localOrigin">;
  readonly mail: Pick<MailFacade, "send">;
}

export function makeEmailVerification(d: EmailVerificationDeps) {
  const { platform } = d;

  /** Новая ссылка пользователя (прежняя гаснет); db — транзакция регистрации или SystemDb. Возвращает токен. */
  async function issue(db: IdentityDb, userId: UserId): Promise<string> {
    const token = newLinkToken();
    const now = platform.clock.now();
    const hours = await platform.settings.get(VERIFY_LINK_HOURS);
    await saveLinkToken(db, {
      purpose: "verify-email",
      userId,
      tokenHash: linkTokenHash(token),
      expiresAt: new Date(now.getTime() + hours * 3_600_000),
      now,
    });
    return token;
  }

  /** Письмо со ссылкой; адрес сайта — по NFR-24 (настройки, не Host запроса). Сбой SMTP — UNAVAILABLE (из mail). */
  async function deliver(email: string, token: string): Promise<void> {
    const origin = await resolveLinkOrigin(platform.settings, platform.localOrigin);
    const link = new URL("/verify-email", origin);
    link.searchParams.set("token", token);
    await d.mail.send(email, {
      kind: "verify-email",
      link: link.href,
      hours: await platform.settings.get(VERIFY_LINK_HOURS),
    });
  }

  /** Переход по ссылке: адрес подтверждён; ссылка использована, истекла или неизвестна — LINK_INVALID. */
  async function verify(token: string): Promise<void> {
    const now = platform.clock.now();
    const userId = await consumeLinkToken(platform.system, {
      purpose: "verify-email",
      tokenHash: linkTokenHash(token),
      now,
    });
    if (userId === undefined || !(await markEmailVerified(platform.system, userId, now))) {
      throw new AppError("LINK_INVALID");
    }
    platform.log.info({ userId }, "identity.email-verified");
  }

  return { issue, deliver, verify };
}

export type EmailVerification = ReturnType<typeof makeEmailVerification>;
