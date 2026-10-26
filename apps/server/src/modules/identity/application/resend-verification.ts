// «Отправить письмо ещё раз» (AUTH-03, SEC-02): частота — на пользователя; адрес уже подтверждён — ничего не шлём.
// Сбой SMTP здесь — ошибка для человека (UNAVAILABLE): он нажал кнопку и ждёт письмо.
import type { UserId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { LinkRequest } from "../../../platform/http/link-origin.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { userCard } from "../infrastructure/db/identity.repo.ts";
import { RESEND_VERIFICATION, rateRuleOf } from "../settings.ts";
import type { EmailVerification } from "./email-verification.ts";

export interface ResendVerificationDeps {
  readonly platform: Pick<SystemPlatform, "system" | "settings" | "rateLimiter" | "log">;
  readonly verification: EmailVerification;
}

export function makeResendVerification(d: ResendVerificationDeps) {
  const { platform } = d;
  return async function resendVerification(s: ScopedDb, request: LinkRequest): Promise<void> {
    const userId: UserId = s.scope.userId;
    await platform.rateLimiter.enforce(
      await rateRuleOf(platform.settings, RESEND_VERIFICATION),
      userId,
    );
    const user = await userCard(platform.system, userId);
    if (user === undefined) throw new AppError("UNAUTHORIZED");
    if (user.emailVerified) return;
    const token = await d.verification.issue(platform.system, userId);
    await d.verification.deliver(user.email, token, request);
    platform.log.info({ userId }, "identity.verification-resent");
  };
}
