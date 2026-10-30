// Системное событие общей базы без своего владельца (законы, LAW-30…34): публикуется от имени первого активного администратора —
// как `identity.system-initialized`, которое тоже идёт под его scope. ScopedDb строится в identity (new-user-scope.ts, ARCHITECTURE §6.4):
// другим модулям Scope по входу не отдаётся. Администратора ещё нет (система не инициализирована) — undefined, события нет.
import { HouseholdId, UserId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { firstActiveAdmin } from "../infrastructure/db/identity.repo.ts";
import { adminScope } from "./new-user-scope.ts";

export function makeAdminScoped(d: Pick<SystemPlatform, "system" | "scoped">) {
  return async function adminScoped(): Promise<ScopedDb | undefined> {
    const admin = await firstActiveAdmin(d.system);
    if (admin === undefined) return undefined;
    return adminScope(d, {
      userId: UserId.parse(admin.id),
      householdId: HouseholdId.parse(admin.householdId),
    });
  };
}
