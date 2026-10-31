// Системное событие общей базы без своего владельца (законы, LAW-30…34): публикуется от имени первого активного администратора —
// как `identity.system-initialized`, которое тоже идёт под его scope. ScopedDb строится в identity (new-user-scope.ts, ARCHITECTURE §6.4)
// и наружу не выходит: другие модули получают только «опубликуй событие с этими id» (ROLE-01, PRIV-07). Администратора ещё нет
// (система не инициализирована) — события нет, ответ `false`.
import { HouseholdId, UserId } from "@kosht/kernel";
import type { EventDef } from "../../../platform/events/define-event.ts";
import type { Events } from "../../../platform/events/events.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { firstActiveAdmin } from "../infrastructure/db/identity.repo.ts";
import { adminScope } from "./new-user-scope.ts";

export type SystemEvent = EventDef<{ readonly ids: readonly string[] }>;

export function makePublishSystemEvent(
  d: Pick<SystemPlatform, "system" | "scoped"> & { readonly events: Pick<Events, "publish"> },
) {
  return async function publishSystemEvent(
    event: SystemEvent,
    ids: readonly string[],
  ): Promise<boolean> {
    const admin = await firstActiveAdmin(d.system);
    if (admin === undefined) return false;
    const s = adminScope(d, {
      userId: UserId.parse(admin.id),
      householdId: HouseholdId.parse(admin.householdId),
    });
    await s.transaction((tx) => d.events.publish(tx, event, { ids: [...ids] }));
    return true;
  };
}
