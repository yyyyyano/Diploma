// Состояние системы для стартового маршрута сайта (AUTH-10, NFR-24): экран первого запуска доступен, только пока
// система не инициализирована и только на локальном входе.
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { isInitialized, userCard } from "../infrastructure/db/identity.repo.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";

export function makeStatus(d: Pick<SystemPlatform, "system">) {
  return async function status(local: boolean) {
    const initialized = await isInitialized(d.system);
    // DEMO-04: демо-вход — как и первый запуск, только на локальном слушателе.
    return { initialized, setupAvailable: !initialized && local, demoAvailable: local };
  };
}

/** Кто вошёл: email, имя и роль пользователя сессии. */
export function makeMe(d: Pick<SystemPlatform, "system">) {
  return async function me(s: ScopedDb) {
    const user = await userCard(d.system, s.scope.userId);
    if (user === undefined) throw new AppError("UNAUTHORIZED");
    return user;
  };
}
