// Настройки demo (DEMO-04): создавать ли демо-данные сразу после первого запуска. Тесты и e2e выключают её (`DEMO_AUTOSTART=0`):
// демо-пользователь появлялся бы в каждом стенде с первым запуском. Кнопка «Войти как демо-пользователь» создаёт демо и без неё.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

export const DEMO_AUTOSTART = defineSetting({
  key: "demo.autostart",
  schema: z.boolean(),
  default: true,
  env: "DEMO_AUTOSTART",
  fromEnv: (raw) => !["0", "false", "no", "off"].includes(raw.trim().toLowerCase()),
});
