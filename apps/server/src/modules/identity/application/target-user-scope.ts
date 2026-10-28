// Где рождается Scope другого пользователя (ARCHITECTURE §6.4, T-017): удаление пользователя администратором (ADM-30).
// Данные удаляемого удаляются под его собственным ScopedDb — ни один модуль не получает «чужое» домохозяйство из
// входа процедуры. Scope строится только после перепроверки в базе, что тот, кто просит, — активный администратор (роль
// сессии могла устареть), а домохозяйство цели — из её строки identity_users, не из входа.
import { makeScope, UserId, type Scope } from "@kosht/kernel";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { accountOf } from "../infrastructure/db/identity.repo.ts";

export function makeTargetUserScope(d: Pick<SystemPlatform, "system">) {
  /** Scope и учётная запись пользователя targetId для действия администратора actor; не админ — FORBIDDEN. */
  return async function targetUserScope(actor: Scope, targetId: string) {
    const admin = await accountOf(d.system, actor.userId);
    if (admin?.role !== "admin" || admin.status !== "active") throw new AppError("FORBIDDEN");
    const target = await accountOf(d.system, targetId);
    if (target === undefined) throw new AppError("NOT_FOUND");
    const scope: Scope = makeScope({
      userId: UserId.parse(targetId),
      householdId: target.householdId,
    });
    return { scope, account: target };
  };
}
