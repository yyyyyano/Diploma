// Выбор модели пользователем (LLM-10, PRIV-02): список моделей, разрешённых администратором и облачным согласием
// пользователя, и сохранение выбора. «Авто» — цепочка по задаче (modelId: null). Выбор хранится у пользователя
// (llm_preferences), id пользователя во входе нет. Экран выбора в чате — T-043.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Модель, которую пользователь может выбрать: запись реестра без цен и лимитов (это служебное). */
export const LlmModelChoice = z.strictObject({
  id: z.string().min(1).max(200),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(200),
  /** Облачная: данные уходят провайдеру за рубеж (доступна только с облачным согласием). */
  cloud: z.boolean(),
});
export type LlmModelChoice = z.infer<typeof LlmModelChoice>;

export const LlmModels = z.strictObject({
  items: z.array(LlmModelChoice).max(200),
  /** Выбранная модель; null — «Авто (рекомендуется)». Недоступная (отозвано согласие, выключена) — тоже null. */
  selected: z.string().nullable(),
});
export type LlmModels = z.infer<typeof LlmModels>;

export const llmContract = {
  /** Модели для выбора в чате и текущий выбор вошедшего. */
  models: oc
    .route({ method: "GET", path: "/llm/models" })
    .output(LlmModels)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Выбрать модель или вернуть «Авто» (modelId: null). Нет в списке разрешённых — VALIDATION. */
  setPreferredModel: oc
    .route({ method: "POST", path: "/llm/preferred-model" })
    .input(z.strictObject({ modelId: z.string().min(1).max(200).nullable() }))
    .output(LlmModels)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED")),
};
