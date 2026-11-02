// identity.system-initialized → демо-данные (DEMO-04: «создаётся при первом запуске вместе с остальными данными демо»). Событие
// системное, владелец задачи — администратор, но scope демо-пользователя обработчик берёт у identity (ensure), а не из конверта.
// Выключено настройкой demo.autostart; повторная доставка ничего не пишет (демо уже готово).
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { systemInitialized } from "../../identity/index.ts";
import type { Demo } from "../application/demo.ts";
import { DEMO_AUTOSTART } from "../settings.ts";

export function onSystemInitialized(
  platform: Pick<Platform, "settings">,
  demo: Pick<Demo, "ensure">,
) {
  return defineSubscription({
    event: systemInitialized,
    module: "demo",
    options: { retryLimit: 1 },
    handle: async () => {
      if (!(await platform.settings.get(DEMO_AUTOSTART))) return;
      await demo.ensure();
    },
  });
}
