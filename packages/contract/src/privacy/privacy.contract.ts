// Согласия (PRIV-01, PRIV-02, AUTH-02): что человек отметил и какую версию текста видел. Согласие на обработку ПД
// обязательно (literal true — без него вход не проходит схему), облачное — по желанию. Версия — строка из словаря
// policy (CONSENT_VERSIONS): сервер сверяет её с текущей и хранит вместе с согласием.
import { z } from "zod";

/** Версия текста согласия (дата правки, `2026-10-26`). */
export const ConsentVersion = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RegistrationConsents = z.strictObject({
  personalData: z.strictObject({ accepted: z.literal(true), version: ConsentVersion }),
  cloud: z.strictObject({ accepted: z.boolean(), version: ConsentVersion }),
});
export type RegistrationConsents = z.infer<typeof RegistrationConsents>;
