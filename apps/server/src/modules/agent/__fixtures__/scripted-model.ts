// Скриптованная «кассета» для сценариев агента (NFR-11, QA-17): модель отвечает по записанному заранее сценарию шаг за
// шагом — вызов инструментов или текст; запросы к модели сохраняются, чтобы тест мог проверить, что ей отправили
// (история, блок контекста, набор инструментов). Живая запись через шлюз — `make ai-record`; здесь поведение
// программы вокруг модели (стражи, проверка чисел, подтверждения), которое от модели не зависит.
import {
  MockLanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
} from "@kosht/testing";
import { simulateReadableStream } from "ai";

export type ScriptStep =
  | { readonly tools: readonly { readonly name: string; readonly input: object }[] }
  | { readonly text: string; readonly kosht?: { model: string; unavailable: string[] } };

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function chunksOf(step: ScriptStep, index: number): LanguageModelV4StreamPart[] {
  if ("tools" in step) {
    return [
      ...step.tools.map((call, n): LanguageModelV4StreamPart => ({
        type: "tool-call",
        toolCallId: `call-${String(index)}-${String(n)}`,
        toolName: call.name,
        input: JSON.stringify(call.input),
      })),
      { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
    ];
  }
  return [
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: step.text },
    { type: "text-end", id: "t" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage,
      ...(step.kosht === undefined ? {} : { providerMetadata: { kosht: step.kosht } }),
    },
  ];
}

export function scriptedModel(steps: readonly ScriptStep[]) {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      const index = calls.length;
      calls.push(options);
      const step = steps[index];
      if (step === undefined) throw new Error(`Сценарий исчерпан: нет шага ${String(index + 1)}.`);
      return { stream: simulateReadableStream({ chunks: chunksOf(step, index) }) };
    },
  });
  return { model, calls };
}

/** Весь текст запроса к модели (сообщения всех ролей) одной строкой — для проверки «что отправили». */
export function promptText(options: LanguageModelV4CallOptions): string {
  return options.prompt
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ("text" in part ? part.text : "")).join(""),
    )
    .join("\n");
}
