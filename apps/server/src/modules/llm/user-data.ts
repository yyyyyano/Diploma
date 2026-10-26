// Владелец данных модуля llm (PRIV-06, OBS-05): своих пользовательских таблиц нет, но трассы Langfuse пользователя —
// его данные; хук afterDelete удаляет их при удалении аккаунта (или ставит в очередь повторов).
import { defineUserData } from "../../platform/db/user-data.ts";
import type { TraceDeletion } from "./application/trace-deletion.ts";

export function llmUserData(traces: Pick<TraceDeletion, "deleteUserTraces">) {
  return defineUserData({ tables: [], afterDelete: traces.deleteUserTraces });
}
