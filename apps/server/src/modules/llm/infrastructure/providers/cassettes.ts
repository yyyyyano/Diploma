// Кассеты моделей (NFR-11, QA-17, ARCHITECTURE §12): запись на границе шлюза llm — обёртка LanguageModelV4, а не
// HTTP, поэтому не ломается при смене провайдера. Режимы: live — модель цепочки как есть; record — она же, а каждый
// шаг пишется в файл кассеты; replay — шаги отдаёт файл, сети нет. Ключ — «сценарий + номер шага» в запуске, плюс
// мягкая проверка отпечатка (имена инструментов, выбор инструмента, последнее сообщение): промах или устаревшая
// запись — ошибка с подсказкой `make ai-record SCENARIO=…`, а не поход в сеть. Паузы между кусками потока
// сохраняются: e2e проверяет, что ответ идёт по мере генерации. Здесь, а не в @kosht/testing: боевой код (e2e, режим
// replay процесса api) не может импортировать пакет тестов.
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const CASSETTE_MODES = ["live", "record", "replay"] as const;
export type CassetteMode = (typeof CASSETTE_MODES)[number];

export interface CassetteRef {
  /** Имя для подсказки перезаписи: `chat/accounts` → `make ai-record SCENARIO=chat/accounts`. */
  readonly scenario: string;
  readonly file: string;
}

const Step = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stream"),
    fingerprint: z.string(),
    parts: z.array(
      z.object({ delayMs: z.int().min(0), part: z.looseObject({ type: z.string() }) }),
    ),
  }),
  z.object({
    kind: z.literal("generate"),
    fingerprint: z.string(),
    result: z.looseObject({ content: z.array(z.unknown()) }),
  }),
]);
type Step = z.infer<typeof Step>;

const CassetteFile = z.object({
  version: z.literal(1),
  scenario: z.string(),
  steps: z.array(Step),
});

/** Промах кассеты: шага нет или запись устарела. Наружу — INTERNAL; в тесте — подсказка перезаписи. */
export class CassetteError extends Error {
  readonly code = "CASSETTE_MISS";
  override readonly name = "CassetteError";
}

const hint = (ref: CassetteRef) => `выполните make ai-record SCENARIO=${ref.scenario}`;

/** Отпечаток запроса: инструменты, выбор инструмента и последнее сообщение (текст и вызовы инструментов). */
export function fingerprint(options: LanguageModelV4CallOptions): string {
  const tools = (options.tools ?? []).map((t) => t.name).toSorted();
  const last = options.prompt.at(-1);
  const content =
    last === undefined
      ? null
      : typeof last.content === "string"
        ? last.content
        : last.content.map((part) =>
            part.type === "text"
              ? part.text
              : part.type === "tool-result"
                ? part.toolName
                : part.type,
          );
  return createHash("sha256")
    .update(
      JSON.stringify({
        tools,
        choice: options.toolChoice?.type ?? null,
        role: last?.role,
        content,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Модель из кассеты: шаги по порядку в запуске (новая модель — новый запуск, счёт с нуля). */
export function replayModel(
  ref: CassetteRef,
  options: { readonly delays: boolean },
): LanguageModelV4 {
  let steps: Step[] | undefined;
  let next = 0;
  const take = (kind: Step["kind"], call: LanguageModelV4CallOptions): Step => {
    if (steps === undefined) {
      let raw: string;
      try {
        raw = readFileSync(ref.file, "utf8");
      } catch {
        throw new CassetteError(`Кассеты ${ref.scenario} нет — ${hint(ref)}.`);
      }
      steps = CassetteFile.parse(JSON.parse(raw)).steps;
    }
    const index = next;
    next += 1;
    const step = steps[index];
    if (step === undefined) {
      throw new CassetteError(
        `Кассета ${ref.scenario}: нет шага ${String(index + 1)} — ${hint(ref)}.`,
      );
    }
    if (step.kind !== kind || step.fingerprint !== fingerprint(call)) {
      throw new CassetteError(
        `Кассета ${ref.scenario}, шаг ${String(index + 1)}: запись устарела (другой запрос) — ${hint(ref)}.`,
      );
    }
    return step;
  };
  return {
    specificationVersion: "v4",
    provider: "cassette",
    modelId: ref.scenario,
    supportedUrls: {},
    async doGenerate(call) {
      const step = take("generate", call);
      if (step.kind !== "generate") throw new CassetteError(hint(ref));
      return step.result as unknown as LanguageModelV4GenerateResult;
    },
    async doStream(call) {
      const step = take("stream", call);
      if (step.kind !== "stream") throw new CassetteError(hint(ref));
      const parts = step.parts;
      let index = 0;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            const item = parts[index];
            index += 1;
            if (item === undefined) {
              controller.close();
              return;
            }
            if (options.delays) await wait(item.delayMs, call.abortSignal);
            controller.enqueue(item.part as unknown as LanguageModelV4StreamPart);
          },
        }),
      };
    },
  };
}

/** Служебные куски без смысла для повтора (метаданные ответа с датой, сырые данные провайдера). */
const SKIPPED = new Set(["response-metadata", "raw"]);

/** Запись: модель отвечает как обычно, а шаги ложатся в файл кассеты (перезаписывается целиком с первого шага). */
export function recordingModel(inner: LanguageModelV4, ref: CassetteRef): LanguageModelV4 {
  const steps: Step[] = [];
  const save = () => {
    mkdirSync(dirname(ref.file), { recursive: true });
    writeFileSync(
      ref.file,
      `${JSON.stringify({ version: 1, scenario: ref.scenario, steps }, null, 2)}\n`,
    );
  };
  return {
    specificationVersion: "v4",
    provider: inner.provider,
    modelId: inner.modelId,
    supportedUrls: inner.supportedUrls,
    async doGenerate(call) {
      const result = await inner.doGenerate(call);
      const { content, finishReason, usage, warnings } = result;
      steps.push({
        kind: "generate",
        fingerprint: fingerprint(call),
        result: JSON.parse(JSON.stringify({ content, finishReason, usage, warnings })) as {
          content: unknown[];
        },
      });
      save();
      return result;
    },
    async doStream(call) {
      const result = await inner.doStream(call);
      const parts: { delayMs: number; part: { type: string } }[] = [];
      const step: Step = { kind: "stream", fingerprint: fingerprint(call), parts };
      steps.push(step);
      let previous = performance.now();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              const now = performance.now();
              if (!SKIPPED.has(part.type)) {
                parts.push({
                  delayMs: Math.round(now - previous),
                  part: JSON.parse(JSON.stringify(part)) as { type: string },
                });
                previous = now;
              }
              controller.enqueue(part);
            },
            flush() {
              save();
            },
          }),
        ),
      };
    },
  };
}
