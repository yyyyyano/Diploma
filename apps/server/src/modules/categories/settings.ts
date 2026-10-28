// Настройки категоризации (CAT-06, LLM-05): сколько непокрытых правилами операций уходит модели одним запросом и
// сколько живёт кэш одинаковых классификаций — настройки, а не константы.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** CAT-06: непокрытые правилами — модели пачками не больше этого. */
export const MODEL_BATCH = defineSetting({
  key: "categories.model-batch",
  schema: z.int().min(1).max(100),
  default: 20,
});
