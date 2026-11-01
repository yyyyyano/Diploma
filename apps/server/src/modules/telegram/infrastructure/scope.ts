// Рождение Scope у входа Telegram (ARCHITECTURE §6.4, SEC-04): владелец — только из строки `telegram_links` (по `chat.id`
// личного чата) или из кода привязки; id проверяются схемами kernel. Сценарии получают готовый ScopedDb и сами Scope не
// собирают (`isolation.mjs`: makeScope — только в `telegram/infrastructure/`).
import { HouseholdId, makeScope, UserId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";

export function scopedForOwner(platform: Pick<Platform, "scoped">) {
  return (owner: { readonly userId: string; readonly householdId: string }): ScopedDb =>
    platform.scoped(
      makeScope({
        userId: UserId.parse(owner.userId),
        householdId: HouseholdId.parse(owner.householdId),
      }),
    );
}
