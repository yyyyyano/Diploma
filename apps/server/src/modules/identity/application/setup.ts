// Первый запуск (AUTH-10, ROLE-02, ADM-01): администратор, его домохозяйство и события — в одной транзакции ScopedDb
// нового пользователя (нет записи — нет события). Признак system_state.initialized переводится условным UPDATE:
// повторный или параллельный второй setup получает CONFLICT, а не второго администратора. Хэш пароля (≈ 0,13 с) —
// до транзакции. Код восстановления (AUTH-05) создаётся в той же транзакции и возвращается один раз — экран первого
// запуска показывает его сразу. Контакт загрузчика законов (LAW-36) — второе поле экрана, по умолчанию email (AUTH-10): в событие он не
// кладётся (нагрузка — только id, OBS-04), его читает legal-base фасадом identity.loaderContact().
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { systemInitialized, userRegistered } from "../events.ts";
import {
  claimInitialization,
  insertUser,
  isInitialized,
  newUserIds,
  type IdentityDb,
} from "../infrastructure/db/identity.repo.ts";
import { hashPassword } from "../infrastructure/password.ts";
import { newUserScope } from "./new-user-scope.ts";

export type SetupDeps = Pick<SystemPlatform, "system" | "scoped" | "events" | "clock" | "log"> & {
  /** Новый код восстановления в транзакции первого запуска (recovery-code.ts). */
  readonly issueRecoveryCode: (db: IdentityDb, userId: string) => Promise<{ code: string }>;
};

/** Контакт загрузчика: заданный на экране или, если поле пусто, email администратора (AUTH-10). */
function loaderContactOf(input: { email: string; loaderContact?: string | undefined }): string {
  const given = input.loaderContact?.trim();
  return given === undefined || given === "" ? input.email.toLowerCase() : given;
}

export function makeSetup(d: SetupDeps) {
  return async function setup(input: {
    email: string;
    password: string;
    loaderContact?: string | undefined;
  }): Promise<{ recoveryCode: string }> {
    if (await isInitialized(d.system)) throw new AppError("CONFLICT");
    const passwordHash = await hashPassword(input.password);
    const ids = await newUserIds(d.system);
    const s = newUserScope(d, ids);
    const recoveryCode = await s.transaction(async (tx) => {
      if (!(await claimInitialization(tx.db, d.clock.now(), loaderContactOf(input))))
        throw new AppError("CONFLICT");
      await insertUser(tx.db, {
        ...ids,
        email: input.email.toLowerCase(),
        role: "admin",
        passwordHash,
      });
      await d.events.publish(tx, systemInitialized, { ids: [ids.userId] });
      await d.events.publish(tx, userRegistered, { ids: [ids.userId] });
      return (await d.issueRecoveryCode(tx.db, ids.userId)).code;
    });
    d.log.info({ userId: ids.userId, role: "admin" }, "identity.system-initialized");
    return { recoveryCode };
  };
}
