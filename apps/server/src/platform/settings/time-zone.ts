// Настройка «часовой пояс» (NFR-23, ADM-60): по умолчанию Минск, env TIME_ZONE, админка важнее. Корень композиции
// подаёт её в часы: createClock(() => settings.peek(TIME_ZONE)) — часы о настройках не знают (platform/clock).
import { DEFAULT_TIME_ZONE } from "@kosht/kernel";
import { TimeZoneSchema } from "../clock/clock.ts";
import { defineSetting } from "./settings.ts";

export const TIME_ZONE = defineSetting({
  key: "system.time-zone",
  schema: TimeZoneSchema,
  default: DEFAULT_TIME_ZONE,
  env: "TIME_ZONE",
});
