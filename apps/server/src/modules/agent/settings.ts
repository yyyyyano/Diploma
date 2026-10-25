// Настройки агента (AGT-01): предел шагов цикла — по умолчанию 8; на последнем шаге инструменты выключены, чтобы
// ответ не остался пустым.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

export const MAX_STEPS = defineSetting({
  key: "agent.max-steps",
  schema: z.int().min(2).max(20),
  default: 8,
});
