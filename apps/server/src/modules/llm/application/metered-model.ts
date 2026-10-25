// Обёртка модели цепочки (LLM-06, ARCHITECTURE §4.3): перед каждым вызовом — запрет вызова внутри s.transaction,
// после — строка журнала расхода (задача, провайдер, модель, токены, длительность, стоимость, код ошибки — без
// текстов). Поток считается завершённым по куску finish; оборванный клиентом поток — строка с кодом ABORTED.
// Сбой записи журнала ответа не ломает: строка не записана — предупреждение в лог (llm.usage-failed).
import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { inTransaction } from "../../../platform/db/transaction-flag.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import { costMicros, type Price } from "../domain/cost.ts";
import type { UsageRow } from "../infrastructure/db/llm.repo.ts";
import { LlmInTransactionError } from "./errors.ts";

export interface MeterDeps {
  readonly record: (row: UsageRow) => Promise<void>;
  readonly now: () => Date;
  readonly log: Logger;
}

export interface CallMeta {
  readonly task: string;
  readonly price: Price;
  /** Провайдер и модель по записи реестра (а не по тому, как называет себя адаптер). */
  readonly provider: string;
  readonly modelId: string;
}

/** Не вызывать модель из транзакции ScopedDb. */
export function assertOutsideTransaction(): void {
  if (inTransaction()) throw new LlmInTransactionError();
}

/** Код ошибки для журнала — без текста: код каталога или имя класса ошибки. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error && /^[A-Za-z]+$/.test(error.name)) return error.name;
  return "UNKNOWN";
}

function tokens(usage: LanguageModelV4Usage | undefined) {
  return { input: usage?.inputTokens.total ?? 0, output: usage?.outputTokens.total ?? 0 };
}

export function meteredModel(
  model: LanguageModelV4,
  meta: CallMeta,
  deps: MeterDeps,
): LanguageModelV4 {
  const record = async (
    started: number,
    usage: LanguageModelV4Usage | undefined,
    errorCode: string | null,
  ) => {
    const counted = tokens(usage);
    try {
      await deps.record({
        task: meta.task,
        provider: meta.provider,
        model: meta.modelId,
        inputTokens: counted.input,
        outputTokens: counted.output,
        ms: Math.round(performance.now() - started),
        costMicros: costMicros(counted, meta.price),
        errorCode,
        createdAt: deps.now(),
      });
    } catch (error) {
      deps.log.warn({ err: error, code: "LLM_USAGE" }, "llm.usage-failed");
    }
  };
  return {
    specificationVersion: "v4",
    provider: meta.provider,
    modelId: meta.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(call) {
      assertOutsideTransaction();
      const started = performance.now();
      try {
        const result = await model.doGenerate(call);
        await record(started, result.usage, null);
        return result;
      } catch (error) {
        await record(started, undefined, errorCodeOf(error));
        throw error;
      }
    },
    async doStream(call) {
      assertOutsideTransaction();
      const started = performance.now();
      let result: Awaited<ReturnType<LanguageModelV4["doStream"]>>;
      try {
        result = await model.doStream(call);
      } catch (error) {
        await record(started, undefined, errorCodeOf(error));
        throw error;
      }
      let usage: LanguageModelV4Usage | undefined;
      let errorCode: string | null = null;
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              if (part.type === "finish") usage = part.usage;
              if (part.type === "error") errorCode = errorCodeOf(part.error);
              controller.enqueue(part);
            },
            flush: () => record(started, usage, errorCode),
            cancel: () => record(started, usage, "ABORTED"),
          }),
        ),
      };
    },
  };
}
