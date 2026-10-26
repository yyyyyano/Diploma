// Регистрация (AUTH-01, AUTH-02, AUTH-03, PRIV-01, PRIV-02, SEC-02): частота — на email и на всех; занятый email —
// EMAIL_TAKEN. Пользователь, его домохозяйство, согласия (privacy), ссылка подтверждения и событие
// identity.user-registered («Наличные», STMT-01) — одна транзакция ScopedDb нового пользователя (new-user-scope.ts).
// Хэш пароля — до транзакции, письмо и вход — после: сбой SMTP не отменяет регистрацию (адрес подтверждается позже
// кнопкой «Отправить письмо ещё раз»), пользоваться системой можно сразу.
import { AppError } from "../../../platform/errors/app-error.ts";
import type { LinkRequest } from "../../../platform/http/link-origin.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { RegistrationConsents } from "@kosht/contract";
import type { PrivacyFacade } from "../../privacy/index.ts";
import { userRegistered } from "../events.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";
import {
  emailTaken,
  insertUser,
  newUserIds,
  userCard,
} from "../infrastructure/db/identity.repo.ts";
import { hashPassword } from "../infrastructure/password.ts";
import { REGISTER_PER_EMAIL, REGISTER_TOTAL, rateRuleOf } from "../settings.ts";
import type { EmailVerification } from "./email-verification.ts";
import { newUserScope } from "./new-user-scope.ts";

export interface RegisterDeps {
  readonly platform: Pick<
    SystemPlatform,
    "system" | "scoped" | "events" | "clock" | "log" | "settings" | "rateLimiter"
  >;
  readonly auth: AuthGateway;
  readonly privacy: PrivacyFacade;
  readonly verification: EmailVerification;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly consents: RegistrationConsents;
}

/** Ключ общего порога регистраций (HMAC от него — в rate_limits). */
const ALL = "all";

export function makeRegister(d: RegisterDeps) {
  const { platform } = d;
  return async function register(
    input: RegisterInput,
    request: LinkRequest & { readonly headers: Headers },
  ) {
    const email = input.email.toLowerCase();
    await platform.rateLimiter.enforce(
      await rateRuleOf(platform.settings, REGISTER_PER_EMAIL),
      email,
    );
    await platform.rateLimiter.enforce(await rateRuleOf(platform.settings, REGISTER_TOTAL), ALL);
    if (await emailTaken(platform.system, email)) throw new AppError("EMAIL_TAKEN");

    const passwordHash = await hashPassword(input.password);
    const ids = await newUserIds(platform.system);
    const token = await newUserScope(platform, ids).transaction(async (tx) => {
      await insertUser(tx.db, { ...ids, email, role: "user", passwordHash });
      await d.privacy.recordRegistrationConsents(tx, input.consents);
      await platform.events.publish(tx, userRegistered, { ids: [ids.userId] });
      return d.verification.issue(tx.db, ids.userId);
    });
    platform.log.info({ userId: ids.userId, role: "user" }, "identity.user-registered");

    try {
      await d.verification.deliver(email, token, request);
    } catch (error) {
      // Письмо не ушло (SMTP недоступен): аккаунт уже создан, повторить можно из настроек.
      if (!(error instanceof AppError && error.code === "UNAVAILABLE")) throw error;
      platform.log.warn(
        { userId: ids.userId, code: error.code },
        "identity.verification-mail-failed",
      );
    }

    const signed = await d.auth.signIn({ email, password: input.password }, request.headers);
    const user = await userCard(platform.system, ids.userId);
    if (signed.kind !== "ok" || user === undefined) throw new AppError("INTERNAL");
    return { user, cookies: signed.cookies };
  };
}
