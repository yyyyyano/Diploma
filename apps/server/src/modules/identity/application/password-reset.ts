// «Забыли пароль?» (AUTH-04, SEC-02): частота — на email; ответ один и тот же, есть такой email или нет, заблокирован
// ли он и ушло ли письмо (сбой SMTP — только в лог): по ответу не узнать, зарегистрирован ли адрес. Ссылка
// «<адрес сайта>/recovery?token=…» одноразовая, срок — identity.reset-link-minutes (1 ч); проверка срока — по Clock.
// Новый пароль: хэш, все сессии завершены, адрес считается подтверждённым (ссылка пришла на него). Заблокированный
// после выдачи ссылки пароль не меняет — ACCOUNT_BLOCKED.
import { AppError } from "../../../platform/errors/app-error.ts";
import { resolveLinkOrigin, type LinkRequest } from "../../../platform/http/link-origin.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { MailFacade } from "../../mail/index.ts";
import {
  deleteSessions,
  lockUserStatus,
  markEmailVerified,
  setPasswordHash,
  userByEmail,
} from "../infrastructure/db/identity.repo.ts";
import { consumeLinkToken, saveLinkToken } from "../infrastructure/db/link-tokens.repo.ts";
import { linkTokenHash, newLinkToken } from "../infrastructure/link-token.ts";
import { hashPassword } from "../infrastructure/password.ts";
import { PASSWORD_RESET, RESET_LINK_MINUTES, rateRuleOf } from "../settings.ts";

export interface PasswordResetDeps {
  readonly platform: Pick<
    SystemPlatform,
    "system" | "settings" | "clock" | "log" | "localOrigin" | "rateLimiter"
  >;
  readonly mail: MailFacade;
}

export function makePasswordReset(d: PasswordResetDeps) {
  const { platform } = d;

  /** Запрос ссылки: письмо — только активному пользователю; ответ одинаковый во всех случаях. */
  async function request(rawEmail: string, from: LinkRequest): Promise<void> {
    const email = rawEmail.toLowerCase();
    await platform.rateLimiter.enforce(await rateRuleOf(platform.settings, PASSWORD_RESET), email);
    const user = await userByEmail(platform.system, email);
    if (user === undefined || user.status !== "active") return;
    const token = newLinkToken();
    const now = platform.clock.now();
    const minutes = await platform.settings.get(RESET_LINK_MINUTES);
    await saveLinkToken(platform.system, {
      purpose: "reset-password",
      userId: user.userId,
      tokenHash: linkTokenHash(token),
      expiresAt: new Date(now.getTime() + minutes * 60_000),
      now,
    });
    const link = new URL(
      "/recovery",
      await resolveLinkOrigin(platform.settings, platform.localOrigin, from),
    );
    link.searchParams.set("token", token);
    try {
      await d.mail.send(email, { kind: "reset-password", link: link.href, minutes });
      platform.log.info({ userId: user.userId }, "identity.password-reset-requested");
    } catch (error) {
      // Ответ не меняется: иначе сбой почты выдал бы, что такой адрес есть.
      if (!(error instanceof AppError && error.code === "UNAVAILABLE")) throw error;
      platform.log.warn(
        { userId: user.userId, code: error.code },
        "identity.password-reset-mail-failed",
      );
    }
  }

  /** Новый пароль по ссылке; ссылка использована, истекла или неизвестна — LINK_INVALID. */
  async function reset(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const now = platform.clock.now();
    await platform.system.transaction(async (tx) => {
      const userId = await consumeLinkToken(tx, {
        purpose: "reset-password",
        tokenHash: linkTokenHash(token),
        now,
      });
      if (userId === undefined) throw new AppError("LINK_INVALID");
      // Заблокирован после выдачи ссылки — пароль не меняется (откат вернёт и ссылку: разблокированный ею воспользуется).
      if ((await lockUserStatus(tx, userId)) !== "active") throw new AppError("ACCOUNT_BLOCKED");
      await setPasswordHash(tx, userId, passwordHash, now);
      await deleteSessions(tx, userId);
      await markEmailVerified(tx, userId, now);
      platform.log.info({ userId }, "identity.password-reset");
    });
  }

  return { request, reset };
}

export type PasswordReset = ReturnType<typeof makePasswordReset>;
