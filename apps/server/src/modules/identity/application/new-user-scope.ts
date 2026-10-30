// Вход «регистрация / первый запуск» (ARCHITECTURE §6.4): единственное место модулей, где Scope рождается не из
// сессии, конверта задачи или привязки Telegram — у нового пользователя их ещё нет. id выдаёт база (uuidv7()) до
// транзакции; домохозяйство — новое, поэтому чужим оно быть не может. Второй вход — системное событие общей базы (законы):
// scope первого активного администратора, id берёт identity из своей таблицы (admin-scoped.ts), а не из входа. Место разрешено
// в tooling/checks/isolation.mjs.
import { makeScope, type HouseholdId, type UserId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";

export function newUserScope(
  platform: Pick<Platform, "scoped">,
  ids: { readonly userId: UserId; readonly householdId: HouseholdId },
): ScopedDb {
  return platform.scoped(makeScope(ids));
}

/** Scope существующего администратора для системных событий без владельца: id — из строки identity_users (admin-scoped.ts). */
export function adminScope(
  platform: Pick<Platform, "scoped">,
  ids: { readonly userId: UserId; readonly householdId: HouseholdId },
): ScopedDb {
  return platform.scoped(makeScope(ids));
}
