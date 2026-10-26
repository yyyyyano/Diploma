// Сроки ссылок и пороги частоты identity (AUTH-03, AUTH-04, SEC-02): настройки, а не константы — админка меняет их
// без перезапуска. Порог частоты — «сколько попыток за сколько минут» на ключ (email или id пользователя).
import { z } from "zod";
import { defineRateRule, type RateRule } from "../../platform/rate-limit/rate-limit.ts";
import { defineSetting, type SettingDef, type Settings } from "../../platform/settings/settings.ts";

/** Сколько минут действует ссылка сброса пароля (AUTH-04: по умолчанию 1 час). */
export const RESET_LINK_MINUTES = defineSetting({
  key: "identity.reset-link-minutes",
  schema: z.int().min(5).max(1440),
  default: 60,
});

/** Сколько часов действует ссылка подтверждения адреса (макет письма — 24 ч). */
export const VERIFY_LINK_HOURS = defineSetting({
  key: "identity.verify-link-hours",
  schema: z.int().min(1).max(168),
  default: 24,
});

const RateLimitSetting = z.strictObject({
  limit: z.int().min(1).max(1000),
  windowMinutes: z.int().min(1).max(1440),
});
type RateLimitSetting = z.infer<typeof RateLimitSetting>;

/** Порог частоты: имя правила (rate_limits) и настройка с умолчанием. */
export interface RateSetting {
  readonly rule: string;
  readonly setting: SettingDef<RateLimitSetting>;
}

function rateSetting(rule: string, key: string, value: RateLimitSetting): RateSetting {
  return { rule, setting: defineSetting({ key, schema: RateLimitSetting, default: value }) };
}

/** Регистрация на один email: письма на чужой адрес не шлются потоком. */
export const REGISTER_PER_EMAIL = rateSetting("auth.register", "identity.rate-register", {
  limit: 3,
  windowMinutes: 60,
});

/** Регистрации всего: хэш пароля (≈ 0,13 с) не превращается в отказ в обслуживании. */
export const REGISTER_TOTAL = rateSetting("auth.register-total", "identity.rate-register-total", {
  limit: 30,
  windowMinutes: 60,
});

/** «Отправить письмо ещё раз» на пользователя. */
export const RESEND_VERIFICATION = rateSetting(
  "auth.resend-verification",
  "identity.rate-resend-verification",
  { limit: 3, windowMinutes: 60 },
);

/** Попытки входа на email (SEC-02, AUTH-08): подбор пароля упирается в порог. */
export const SIGN_IN = rateSetting("auth.login", "identity.rate-sign-in", {
  limit: 5,
  windowMinutes: 15,
});

/** «Забыли пароль?» на email: письма сброса не шлются потоком. */
export const PASSWORD_RESET = rateSetting("auth.password-reset", "identity.rate-password-reset", {
  limit: 3,
  windowMinutes: 60,
});

/** Вход с кодом восстановления на email: перебор кода упирается в порог. */
export const RECOVERY_CODE = rateSetting("auth.recovery-code", "identity.rate-recovery-code", {
  limit: 5,
  windowMinutes: 15,
});

export const IDENTITY_SETTINGS = [
  VERIFY_LINK_HOURS,
  RESET_LINK_MINUTES,
  SIGN_IN.setting,
  PASSWORD_RESET.setting,
  RECOVERY_CODE.setting,
  REGISTER_PER_EMAIL.setting,
  REGISTER_TOTAL.setting,
  RESEND_VERIFICATION.setting,
];

/** Правило частоты с текущим порогом из настроек. */
export async function rateRuleOf(
  settings: Pick<Settings, "get">,
  rate: RateSetting,
): Promise<RateRule> {
  const { limit, windowMinutes } = await settings.get(rate.setting);
  return defineRateRule({ name: rate.rule, limit, windowMs: windowMinutes * 60_000 });
}
