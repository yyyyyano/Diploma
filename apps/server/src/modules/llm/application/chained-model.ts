// «Цепочка как одна модель» (LLM-03, LLM-05, LLM-10, ARCHITECTURE §8.1): вызов уходит первой модели цепочки; ошибка,
// таймаут, 429 или исчерпанный лимит до начала ответа — следующей. Ответом считается первый кусок текста или
// инструмента: ошибка внутри потока до него тоже переключает модель, а модель, начавшая отвечать, не меняется — иначе
// пользователь увидел бы два начала ответа. Перед вызовом — лимитёр (limiter.ts); после 429 — размыкатель по
// retry-after. Кто ответил и какие модели были недоступны — в providerMetadata.kosht («Модель X недоступна, ответила
// Y»). Администратору — событие «лимит» или «ошибка» (уведомление ai-provider).
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  SharedV4ProviderMetadata,
} from "@ai-sdk/provider";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { StoredModel } from "../infrastructure/db/llm.repo.ts";
import { LlmInTransactionError, LlmTimeoutError } from "./errors.ts";
import type { Limiter } from "./limiter.ts";

export interface ChainEntry {
  readonly record: Pick<StoredModel, "id" | "provider" | "cloud" | "limits">;
  readonly model: LanguageModelV4;
}

/** Что случилось с провайдером: исчерпан лимит (окно, заголовки, 429) или он ответил ошибкой. */
export interface ChainEvent {
  readonly kind: "limit" | "error";
  readonly provider: string;
  readonly model: string;
}

export interface ChainDeps {
  readonly limiter: Limiter;
  /** Сколько ждать первого куска ответа от облачной (cloud) или локальной модели. */
  readonly timeoutMs: (cloud: boolean) => number;
  readonly onEvent?: (event: ChainEvent) => void;
}

/** Метаданные ответа цепочки: ключ providerMetadata.kosht. */
export const CHAIN_METADATA_KEY = "kosht";

/** Куски до содержимого: начало потока и открытие блоков — ответом ещё не считаются. */
const PRELUDE: ReadonlySet<string> = new Set([
  "stream-start",
  "response-metadata",
  "raw",
  "text-start",
  "reasoning-start",
]);

/** Грубая оценка токенов вызова для окон лимитов: 4 символа на токен, файл (изображение) — 1000. */
export function estimateTokens(options: LanguageModelV4CallOptions): number {
  let files = 0;
  const text = JSON.stringify(options.prompt, (_key, value: unknown) => {
    if (value instanceof Uint8Array) {
      files += 1;
      return "";
    }
    return value;
  });
  return Math.ceil(text.length / 4) + files * 1000 + (options.maxOutputTokens ?? 0);
}

interface Deadline {
  readonly signal: AbortSignal;
  /** Отклоняется по истечении срока — для гонки с вызовом, который сигнал не слушает. */
  readonly expired: Promise<never>;
  stop(): void;
}

function startDeadline(ms: number): Deadline {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new LlmTimeoutError(ms);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  // Срок мог истечь, пока никто не ждёт: отказ без обработчика уронил бы процесс.
  expired.catch(() => undefined);
  return { signal: controller.signal, expired, stop: () => clearTimeout(timer) };
}

function withMetadata<T extends { providerMetadata?: SharedV4ProviderMetadata | undefined }>(
  target: T,
  id: string,
  unavailable: readonly string[],
): T {
  const providerMetadata: SharedV4ProviderMetadata = {
    ...target.providerMetadata,
    [CHAIN_METADATA_KEY]: { model: id, unavailable: [...unavailable] },
  };
  return { ...target, providerMetadata };
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Ошибка внутри потока модели.");
}

export function chainedModel(entries: readonly ChainEntry[], deps: ChainDeps): LanguageModelV4 {
  const [first] = entries;
  if (first === undefined) throw new AppError("UNAVAILABLE");
  const { limiter } = deps;

  type Attempt<R> = (
    entry: ChainEntry,
    options: LanguageModelV4CallOptions,
    deadline: Deadline,
    release: () => void,
    unavailable: readonly string[],
  ) => Promise<R>;

  async function run<R>(options: LanguageModelV4CallOptions, attempt: Attempt<R>): Promise<R> {
    const estimate = estimateTokens(options);
    const unavailable: string[] = [];
    let last: unknown;
    for (const entry of entries) {
      const { id, provider, cloud, limits } = entry.record;
      const block = await limiter.check({ id, limits }, estimate);
      if (block !== undefined) {
        unavailable.push(id);
        // Суточный лимит кончился — администратору; минутное окно и ожидание после 429 — обычная работа цепочки.
        if (block.kind === "rpd" || block.kind === "tpd") {
          deps.onEvent?.({ kind: "limit", provider, model: id });
        }
        continue;
      }
      const release = limiter.reserve(id, estimate);
      const deadline = startDeadline(deps.timeoutMs(cloud));
      const signals = [deadline.signal, ...(options.abortSignal ? [options.abortSignal] : [])];
      try {
        return await attempt(
          entry,
          { ...options, abortSignal: AbortSignal.any(signals) },
          deadline,
          release,
          unavailable,
        );
      } catch (error) {
        deadline.stop();
        release();
        // «Стоп» пользователя и баг кода — не сбой провайдера: следующая модель их не исправит.
        if (options.abortSignal?.aborted === true || error instanceof LlmInTransactionError) {
          throw error;
        }
        last = error;
        unavailable.push(id);
        deps.onEvent?.({
          kind: limiter.rejected(id, error) ? "limit" : "error",
          provider,
          model: id,
        });
      }
    }
    throw last ?? new AppError("UNAVAILABLE");
  }

  /** Первый кусок ответа: ошибка до него — следующая модель, после — как есть (метаданные — в finish). */
  async function openStream(
    entry: ChainEntry,
    options: LanguageModelV4CallOptions,
    deadline: Deadline,
    release: () => void,
    unavailable: readonly string[],
  ) {
    const { id } = entry.record;
    const result = await Promise.race([entry.model.doStream(options), deadline.expired]);
    const reader = result.stream.getReader();
    const buffered: LanguageModelV4StreamPart[] = [];
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), deadline.expired]);
        if (next.done) break;
        if (next.value.type === "error") throw asError(next.value.error);
        buffered.push(next.value);
        if (!PRELUDE.has(next.value.type)) break;
      }
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    }
    deadline.stop();
    limiter.observe(id, result.response?.headers);
    const patch = (part: LanguageModelV4StreamPart): LanguageModelV4StreamPart =>
      part.type === "finish" ? withMetadata(part, id, unavailable) : part;
    let index = 0;
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async pull(controller) {
        const part = buffered[index];
        if (part !== undefined) {
          index += 1;
          controller.enqueue(patch(part));
          return;
        }
        try {
          const next = await reader.read();
          if (next.done) {
            release();
            controller.close();
          } else {
            controller.enqueue(patch(next.value));
          }
        } catch (error) {
          release();
          throw error;
        }
      },
      async cancel(reason) {
        release();
        await reader.cancel(reason);
      },
    });
    return { ...result, stream };
  }

  return {
    specificationVersion: "v4",
    provider: first.model.provider,
    modelId: first.model.modelId,
    supportedUrls: first.model.supportedUrls,
    doGenerate: (options) =>
      run(options, async (entry, call, deadline, release, unavailable) => {
        try {
          const result = await Promise.race([entry.model.doGenerate(call), deadline.expired]);
          limiter.observe(entry.record.id, result.response?.headers);
          return withMetadata(result, entry.record.id, unavailable);
        } finally {
          deadline.stop();
          release();
        }
      }),
    doStream: (options) => run(options, openStream),
  };
}
