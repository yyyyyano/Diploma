// identity.user-registered → строка настроек итогов недели (WEEK-03): пользователь попадает в обход. Владелец задачи — сам пользователь
// (scope конверта, перепроверенный identity); нагрузке не верим — строка создаётся по ctx.s, идемпотентно.
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { userRegistered } from "../../identity/index.ts";
import { ensureWeeklyPreferences } from "../application/ensure-preferences.ts";

export function onUserRegistered() {
  return defineSubscription({
    event: userRegistered,
    module: "weekly",
    handle: (ctx) => ensureWeeklyPreferences(ctx.s),
  });
}
