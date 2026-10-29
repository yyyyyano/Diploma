// События llm (ADR-0004): нагрузка — пачка id строк llm_local_models (файлы моделей), других данных нет (OBS-04).
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

/** Локальные модели скачаны и проверены (NFR-25): ids — готовые файлы. Подписчики (индексация законов, T-034…) — свои. */
export const localModelsReady = defineEvent({
  name: "llm.local-models-ready",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
