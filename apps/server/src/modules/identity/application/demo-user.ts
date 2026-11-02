// Встроенный демо-пользователь (DEMO-04): запись identity с отметкой demo, облачное согласие выдано по умолчанию (иначе показ
// шёл бы на медленной локальной модели), событие регистрации — как у обычного пользователя («Наличные», строка итогов недели).
// Пароль человеку не нужен: он выводится из мастер-ключа (HMAC) и нигде не показывается и не хранится открыто — войти с ним
// может только identity, по кнопке на локальном адресе (маршрут localOnly). Scope демо отдаёт identity: модуль demo не
// собирает его сам (makeScope — только в разрешённых местах, isolation.mjs).
import { CONSENT_VERSIONS } from "@kosht/i18n";
import type { Scope } from "@kosht/kernel";
import { createHmac } from "node:crypto";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { PrivacyFacade } from "../../privacy/index.ts";
import { userRegistered } from "../events.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";
import {
  findDemoUser,
  insertUser,
  newUserIds,
  userCard,
} from "../infrastructure/db/identity.repo.ts";
import { hashPassword } from "../infrastructure/password.ts";
import { newUserScope } from "./new-user-scope.ts";

/** Адрес демо-пользователя: вымышленный, на зарезервированной для примеров зоне (NFR-18). */
export const DEMO_EMAIL = "irina.k@example.by";

export interface DemoUserDeps {
  readonly platform: Pick<SystemPlatform, "system" | "scoped" | "events" | "log" | "deriveKey">;
  readonly auth: AuthGateway;
  readonly privacy: Pick<PrivacyFacade, "recordRegistrationConsents">;
}

export function makeDemoUser(d: DemoUserDeps) {
  const { platform } = d;

  /** Пароль демо: детерминированный (вход после перезапуска), но без мастер-ключа не угадывается (≥ 12 знаков, SEC-01). */
  const passwordOf = () =>
    createHmac("sha256", platform.deriveKey("auth/v1"))
      .update("demo-user-password")
      .digest("base64url");

  /** Демо-пользователь и его scope; нет — создаётся (одновременные вызовы дают одного: email уникален). */
  async function ensure(): Promise<{ readonly scope: Scope; readonly created: boolean }> {
    const found = await findDemoUser(platform.system);
    if (found !== undefined) return { scope: newUserScope(platform, found).scope, created: false };
    const ids = await newUserIds(platform.system);
    const passwordHash = await hashPassword(passwordOf());
    try {
      await newUserScope(platform, ids).transaction(async (tx) => {
        await insertUser(tx.db, {
          ...ids,
          email: DEMO_EMAIL,
          role: "user",
          passwordHash,
          demo: true,
        });
        await d.privacy.recordRegistrationConsents(tx, {
          personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
          cloud: { accepted: true, version: CONSENT_VERSIONS.cloud },
        });
        await platform.events.publish(tx, userRegistered, { ids: [ids.userId] });
      });
    } catch (error) {
      // Параллельный вызов успел раньше: берём его пользователя.
      if (!(error instanceof AppError && error.code === "EMAIL_TAKEN")) throw error;
      const winner = await findDemoUser(platform.system);
      if (winner === undefined) throw error;
      return { scope: newUserScope(platform, winner).scope, created: false };
    }
    platform.log.info({ userId: ids.userId }, "identity.demo-created");
    return { scope: newUserScope(platform, ids).scope, created: true };
  }

  /** Вход демо-пользователем: сессия Better Auth без ввода пароля. Демо ещё нет — NOT_FOUND. */
  async function signIn(headers: Headers) {
    if ((await findDemoUser(platform.system)) === undefined) throw new AppError("NOT_FOUND");
    const signed = await d.auth.signIn({ email: DEMO_EMAIL, password: passwordOf() }, headers);
    if (signed.kind === "blocked") throw new AppError("ACCOUNT_BLOCKED");
    if (signed.kind !== "ok") throw new AppError("INTERNAL");
    const user = await userCard(platform.system, signed.userId);
    if (user === undefined) throw new AppError("INTERNAL");
    platform.log.info({ userId: signed.userId }, "identity.demo-signed-in");
    return { user, cookies: signed.cookies };
  }

  return { ensure, signIn };
}

export type DemoUser = ReturnType<typeof makeDemoUser>;
