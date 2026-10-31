// Шлюз llm для сценариев агента: чат — скриптованная модель, классификация — заданный ответ (или сбой); остальное в
// сценариях агента не нужно. Трассы — порт платформы без Langfuse.
import type { Scope } from "@kosht/kernel";
import type { MockLanguageModelV4 } from "@kosht/testing";
import { createTelemetry } from "../../../platform/telemetry/telemetry.ts";
import type { LlmFacade } from "../../llm/index.ts";

export function fakeLlm(
  mock: MockLanguageModelV4,
  classify: (task: string, text: string) => string = () => "on-topic",
): { readonly llm: LlmFacade; readonly classified: { task: string; text: string }[] } {
  const telemetry = createTelemetry();
  const classified: { task: string; text: string }[] = [];
  const llm: LlmFacade = {
    model: async (caller, functionId, call) => ({
      model: mock,
      telemetry: telemetry.options({
        functionId,
        userId: (caller as Scope).userId,
        ...(call?.sessionId === undefined ? {} : { sessionId: call.sessionId }),
      }),
    }),
    classify: async (_caller, request) => {
      classified.push({ task: request.task, text: request.text });
      return classify(request.task, request.text) as never;
    },
    extract: () => Promise.reject(new Error("не нужен")),
    embed: () => Promise.reject(new Error("не нужен")),
    transcribe: () => Promise.reject(new Error("не нужен")),
  };
  return { llm, classified };
}
