// Код восстановления (AUTH-05, SEC-01, SEC-02): показывается один раз — при создании администратора и по желанию в
// настройках; хранится хэшем argon2id. «Войти с кодом восстановления»: частота — на email; код и email сверяются
// постоянным по времени сравнением, а для неизвестного email или пользователя без кода всё равно считается хэш —
// время ответа не выдаёт, есть ли такой адрес. Верный код: новый пароль, все сессии завершены, выдан новый код
// (старый больше не работает), вход — сразу.
import type { UserId } from "@kosht/kernel";
import { randomBytes } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { formatRecoveryCode, normalizeRecoveryCode } from "../domain/recovery-code.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";
import {
  deleteSessions,
  setPasswordHash,
  userCard,
  type IdentityDb,
} from "../infrastructure/db/identity.repo.ts";
import {
  recoveryCodeCreatedAt,
  recoveryTarget,
  saveRecoveryCode,
} from "../infrastructure/db/recovery-codes.repo.ts";
import { hashPassword, verifyPassword } from "../infrastructure/password.ts";
import { RECOVERY_CODE, rateRuleOf } from "../settings.ts";

export interface RecoveryCodeDeps {
  readonly platform: Pick<SystemPlatform, "system" | "settings" | "clock" | "log" | "rateLimiter">;
  readonly auth: AuthGateway;
}

/** Хэш, с которым сверяется ввод, когда настоящего нет (неизвестный email): то же время, что и настоящая проверка. */
let decoy: Promise<string> | undefined;

export function makeRecoveryCodes(d: RecoveryCodeDeps) {
  const { platform } = d;

  /** Новый код пользователя: в базу — хэш, наружу — сам код (показать один раз). */
  async function issue(db: IdentityDb, userId: string): Promise<{ code: string; createdAt: Date }> {
    const code = formatRecoveryCode(randomBytes(10));
    const createdAt = platform.clock.now();
    await saveRecoveryCode(
      db,
      userId,
      await hashPassword(normalizeRecoveryCode(code) ?? code),
      createdAt,
    );
    return { code, createdAt };
  }

  /** Создать код в настройках (прежний перестаёт действовать). */
  async function create(s: ScopedDb): Promise<{ code: string; createdAt: Date }> {
    const issued = await issue(platform.system, s.scope.userId);
    platform.log.info({ userId: s.scope.userId }, "identity.recovery-code-created");
    return issued;
  }

  /** Когда создан действующий код (настройки: «Код создан …» или «Кода пока нет»). */
  async function status(s: ScopedDb): Promise<Date | undefined> {
    return recoveryCodeCreatedAt(platform.system, s.scope.userId);
  }

  async function recover(
    input: { readonly email: string; readonly code: string; readonly password: string },
    headers: Headers,
  ) {
    const email = input.email.toLowerCase();
    await platform.rateLimiter.enforce(await rateRuleOf(platform.settings, RECOVERY_CODE), email);
    const target = await recoveryTarget(platform.system, email);
    const code = normalizeRecoveryCode(input.code) ?? "";
    decoy ??= hashPassword("kosht-decoy-recovery-code");
    const matches = await verifyPassword({
      hash: target?.codeHash ?? (await decoy),
      password: code,
    });
    if (target === undefined || target.codeHash === null || !matches) {
      throw new AppError("INVALID_CREDENTIALS");
    }
    if (target.status !== "active") throw new AppError("ACCOUNT_BLOCKED");

    const passwordHash = await hashPassword(input.password);
    const now = platform.clock.now();
    const next = await platform.system.transaction(async (tx) => {
      await setPasswordHash(tx, target.userId, passwordHash, now);
      await deleteSessions(tx, target.userId);
      return issue(tx, target.userId);
    });
    platform.log.info({ userId: target.userId }, "identity.recovered-with-code");

    const signed = await d.auth.signIn({ email, password: input.password }, headers);
    const user = await userCard(platform.system, target.userId as UserId);
    if (signed.kind !== "ok" || user === undefined) throw new AppError("INTERNAL");
    return { user, recoveryCode: next.code, cookies: signed.cookies };
  }

  return { issue, create, status, recover };
}

export type RecoveryCodes = ReturnType<typeof makeRecoveryCodes>;
