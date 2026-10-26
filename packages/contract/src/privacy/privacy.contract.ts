// Согласия (PRIV-01, PRIV-02, AUTH-02): что человек отметил и какую версию текста видел. Согласие на обработку ПД
// обязательно (literal true — без него вход не проходит схему), облачное — по желанию и меняется в настройках в любой
// момент (отзыв действует на следующий же вызов модели). Версия — строка из словаря policy (CONSENT_VERSIONS): сервер
// сверяет её с текущей и хранит вместе с решением.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Версия текста согласия (дата правки, `2026-10-26`). */
export const ConsentVersion = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RegistrationConsents = z.strictObject({
  personalData: z.strictObject({ accepted: z.literal(true), version: ConsentVersion }),
  cloud: z.strictObject({ accepted: z.boolean(), version: ConsentVersion }),
});
export type RegistrationConsents = z.infer<typeof RegistrationConsents>;

/** Вид согласия: обработка ПД (PRIV-01) или облачные модели (PRIV-02). */
export const ConsentKind = z.enum(["personal-data", "cloud"]);
export type ConsentKind = z.infer<typeof ConsentKind>;

/** Строка «Истории согласий»: решение, версия текста, момент (ISO UTC). */
export const ConsentRecord = z.strictObject({
  id: z.uuid(),
  kind: ConsentKind,
  granted: z.boolean(),
  textVersion: ConsentVersion,
  at: z.iso.datetime(),
});
export type ConsentRecord = z.infer<typeof ConsentRecord>;

/** Вкладка «Конфиденциальность»: облако разрешено ли и с какого момента; история решений, новые сверху. */
export const PrivacyState = z.strictObject({
  cloud: z.strictObject({ granted: z.boolean(), since: z.iso.datetime().nullable() }),
  history: z.array(ConsentRecord).max(200),
});
export type PrivacyState = z.infer<typeof PrivacyState>;

/** Дать или отозвать облачное согласие; версия — текста, который человек видел (устарела — CONFLICT). */
export const SetCloudConsentInput = z.strictObject({
  granted: z.boolean(),
  version: ConsentVersion,
});

export const privacyContract = {
  /** Облачное согласие и история согласий вошедшего. */
  state: oc
    .route({ method: "GET", path: "/privacy" })
    .output(PrivacyState)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Дать или отозвать облачное согласие (PRIV-02): новая строка журнала, режим меняется сразу. */
  setCloudConsent: oc
    .route({ method: "POST", path: "/privacy/cloud-consent" })
    .input(SetCloudConsentInput)
    .output(PrivacyState)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "CONFLICT")),
};
