// Владелец данных модуля llm (PRIV-05, PRIV-06, OBS-05): выбор модели пользователя (llm_preferences) выгружается и
// удаляется вместе с аккаунтом; хук afterDelete удаляет трассы Langfuse пользователя (или ставит в очередь повторов).
import { defineUserData } from "../../platform/db/user-data.ts";
import type { TraceDeletion } from "./application/trace-deletion.ts";
import { llmPreferences } from "./infrastructure/db/schema.ts";

export function llmUserData(traces: Pick<TraceDeletion, "deleteUserTraces">) {
  return defineUserData({ tables: [llmPreferences], afterDelete: traces.deleteUserTraces });
}
