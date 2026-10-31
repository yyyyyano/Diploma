// Настройки агента: предел шагов цикла (AGT-01) и окно истории диалога (AGT-08).
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** AGT-01: по умолчанию 8; на последнем шаге инструменты выключены, чтобы ответ не остался пустым. */
export const MAX_STEPS = defineSetting({
  key: "agent.max-steps",
  schema: z.int().min(2).max(20),
  default: 8,
});

/** AGT-08: сколько последних сообщений диалога уходит модели; больше — дороже и упирается в лимит токенов в минуту. */
export const HISTORY_MESSAGES = defineSetting({
  key: "agent.history-messages",
  schema: z.int().min(2).max(50),
  default: 12,
});

export const AGENT_SETTINGS = [MAX_STEPS, HISTORY_MESSAGES];
