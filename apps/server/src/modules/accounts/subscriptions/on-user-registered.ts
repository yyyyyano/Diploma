// identity.user-registered → «Наличные» нового пользователя (STMT-01). Владелец задачи — сам пользователь (scope
// конверта, перепроверенный identity); нагрузке не верим — счёт создаётся по ctx.s, идемпотентно.
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { userRegistered } from "../../identity/index.ts";
import type { makeEnsureCash } from "../application/ensure-cash.ts";

export function onUserRegistered(ensureCash: ReturnType<typeof makeEnsureCash>) {
  return defineSubscription({
    event: userRegistered,
    module: "accounts",
    handle: (ctx) => ensureCash(ctx.s),
  });
}
