// «Цепочка как одна модель» (LLM-03, ARCHITECTURE §8.1): вызов уходит первой модели цепочки; ошибка до начала ответа
// — следующей. Модель, начавшая поток, не меняется: иначе пользователь увидел бы два начала ответа. Лимитёр по
// окнам RPM/TPM, размыкатель по retry-after и пометка «Модель X недоступна, ответила Y» — T-023.
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { AppError } from "../../../platform/errors/app-error.ts";

export function chainedModel(models: readonly LanguageModelV4[]): LanguageModelV4 {
  const [first] = models;
  if (first === undefined) throw new AppError("UNAVAILABLE");
  if (models.length === 1) return first;
  async function attempt<R>(call: (model: LanguageModelV4) => PromiseLike<R>): Promise<R> {
    let last: unknown;
    for (const model of models) {
      try {
        return await call(model);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }
  return {
    specificationVersion: "v4",
    provider: first.provider,
    modelId: first.modelId,
    supportedUrls: first.supportedUrls,
    doGenerate: (options) => attempt((model) => model.doGenerate(options)),
    doStream: (options) => attempt((model) => model.doStream(options)),
  };
}
