// Первый запуск (AUTH-10, ROLE-02, ADM-01): администратор, его домохозяйство и события — в одной транзакции ScopedDb
// нового пользователя (нет записи — нет события). Признак system_state.initialized переводится условным UPDATE:
// повторный или параллельный второй setup получает CONFLICT, а не второго администратора. Хэш пароля (≈ 0,13 с) —
// до транзакции. Код восстановления (AUTH-05) — T-013, контакт загрузчика законов (LAW-36) — T-034.
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { systemInitialized, userRegistered } from "../events.ts";
import {
  claimInitialization,
  insertUser,
  isInitialized,
  newUserIds,
} from "../infrastructure/db/identity.repo.ts";
import { hashPassword } from "../infrastructure/password.ts";
import { newUserScope } from "./new-user-scope.ts";

export type SetupDeps = Pick<SystemPlatform, "system" | "scoped" | "events" | "clock" | "log">;

export function makeSetup(d: SetupDeps) {
  return async function setup(input: { email: string; password: string }): Promise<void> {
    if (await isInitialized(d.system)) throw new AppError("CONFLICT");
    const passwordHash = await hashPassword(input.password);
    const ids = await newUserIds(d.system);
    const s = newUserScope(d, ids);
    await s.transaction(async (tx) => {
      if (!(await claimInitialization(tx.db, d.clock.now()))) throw new AppError("CONFLICT");
      await insertUser(tx.db, {
        ...ids,
        email: input.email.toLowerCase(),
        role: "admin",
        passwordHash,
      });
      await d.events.publish(tx, systemInitialized, { ids: [ids.userId] });
      await d.events.publish(tx, userRegistered, { ids: [ids.userId] });
    });
    d.log.info({ userId: ids.userId, role: "admin" }, "identity.system-initialized");
  };
}
