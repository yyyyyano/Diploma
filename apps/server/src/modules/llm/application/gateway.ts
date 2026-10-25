// Шлюз llm (LLM-01, NFR-04, ARCHITECTURE §8.1) — единственный, кто знает провайдеров. Первый аргумент — кто зовёт:
// scope пользователя (цепочка учитывает облачное согласие, PRIV-02) или systemCaller модуля (задача без данных
// пользователя, PRIV-09). Цепочка — из реестра моделей по возможностям задачи (domain/build-chain.ts); каждая модель
// цепочки обёрнута журналом расхода и запретом вызова в транзакции (metered-model.ts). Режим кассет процесса: replay —
// ответы из кассеты, record — запись шагов. Трассы — опции telemetry с functionId, userId и sessionId (Langfuse —
// T-011).
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { embedMany, generateText, NoObjectGeneratedError, Output, transcribe } from "ai";
import { z } from "zod";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Telemetry, TelemetryCallOptions } from "../../../platform/telemetry/telemetry.ts";
import type { Clock } from "@kosht/kernel";
import { buildChain } from "../domain/build-chain.ts";
import { isSystemCaller, type Caller } from "../domain/caller.ts";
import { costMicros } from "../domain/cost.ts";
import type { LlmTask, StructuredTask } from "../domain/tasks.ts";
import { insertUsage, listModels, type StoredModel } from "../infrastructure/db/llm.repo.ts";
import {
  recordingModel,
  replayModel,
  type CassetteMode,
  type CassetteRef,
} from "../infrastructure/providers/cassettes.ts";
import type { ProviderRegistry } from "../infrastructure/providers/providers.ts";
import { chainedModel } from "./chained-model.ts";
import { LlmSchemaError } from "./errors.ts";
import { assertOutsideTransaction, errorCodeOf, meteredModel } from "./metered-model.ts";

/** Модель чата для агента: сама модель (цепочка) и опции трасс вызова. */
export interface ChatModel {
  readonly model: LanguageModelV4;
  readonly telemetry: TelemetryCallOptions;
}

export interface ExtractRequest<T> {
  readonly task: StructuredTask;
  readonly schema: z.ZodType<T>;
  /** Инструкции — отдельно от документа (SEC-10/11). */
  readonly instructions: string;
  /** Документ — данные: уходит блоком <document>, не инструкциями. */
  readonly document: string;
  /** Версия подсказки (ключ кассет и кэша eval). */
  readonly promptVersion: string;
}

export interface ClassifyRequest<L extends string> {
  readonly task: StructuredTask;
  readonly labels: readonly [L, ...L[]];
  readonly instructions: string;
  readonly text: string;
  readonly promptVersion: string;
}

export interface LlmGateway {
  /** Модель чата (агент): цепочка задачи chat. sessionId — id диалога для трасс. */
  model(caller: Caller, task: "chat", call?: { readonly sessionId?: string }): Promise<ChatModel>;
  /** Извлечение в строгую схему (LLM-04): ответ вне схемы — один повтор, затем LlmSchemaError. */
  extract<T>(caller: Caller, request: ExtractRequest<T>): Promise<T>;
  /** Классификация: одна метка из списка. */
  classify<L extends string>(caller: Caller, request: ClassifyRequest<L>): Promise<L>;
  /** Векторы текстов — только локально (NFR-05). */
  embed(caller: Caller, texts: readonly string[]): Promise<number[][]>;
  /** Расшифровка речи (VOICE): формат аудио AI SDK определяет по содержимому. */
  transcribe(caller: Caller, audio: Uint8Array): Promise<string>;
}

/** Режим кассет процесса: из настроек llm.mode и llm.cassette или (в тестах) задан явно. */
export interface CassetteConfig {
  readonly mode: CassetteMode;
  readonly cassette?: CassetteRef;
  /** Повторять паузы между кусками потока записи (e2e — да, тесты сценариев — нет). */
  readonly delays?: boolean;
}

export interface GatewayDeps {
  readonly system: SystemDb;
  readonly providers: ProviderRegistry;
  readonly consent: { cloudAllowed(scope: Exclude<Caller, { kind: "system" }>): Promise<boolean> };
  readonly telemetry: Telemetry;
  readonly clock: Clock;
  readonly log: Logger;
  readonly cassettes: () => Promise<CassetteConfig>;
}

export function createLlmGateway(d: GatewayDeps): LlmGateway {
  const meter = {
    record: (row: Parameters<typeof insertUsage>[1]) => insertUsage(d.system, row),
    now: () => d.clock.now(),
    log: d.log,
  };

  async function cloudAllowed(caller: Caller): Promise<boolean> {
    return isSystemCaller(caller) ? true : d.consent.cloudAllowed(caller);
  }

  async function chainFor(caller: Caller, task: LlmTask): Promise<StoredModel[]> {
    const chain = buildChain(await listModels(d.system), task, {
      cloudAllowed: await cloudAllowed(caller),
    }) as StoredModel[];
    // Ни одной подходящей модели (всё выключено или нужна облачная без согласия) — сервис недоступен.
    if (chain.length === 0) throw new AppError("UNAVAILABLE");
    return chain;
  }

  function adapterOf(record: StoredModel) {
    const adapter = d.providers.get(record.provider);
    if (adapter === undefined) throw new AppError("UNAVAILABLE");
    return adapter;
  }

  async function languageModel(caller: Caller, task: LlmTask): Promise<LanguageModelV4> {
    assertOutsideTransaction();
    const config = await d.cassettes();
    const free = { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 };
    if (config.mode === "replay") {
      if (config.cassette === undefined) throw new AppError("UNAVAILABLE");
      return meteredModel(
        replayModel(config.cassette, { delays: config.delays ?? true }),
        { task, price: free, provider: "cassette", modelId: config.cassette.scenario },
        meter,
      );
    }
    const chain = (await chainFor(caller, task)).map((record) =>
      meteredModel(
        adapterOf(record).languageModel(record.modelId),
        { task, price: record, provider: record.provider, modelId: record.modelId },
        meter,
      ),
    );
    const model = chainedModel(chain);
    if (config.mode === "record") {
      if (config.cassette === undefined) throw new AppError("UNAVAILABLE");
      return recordingModel(model, config.cassette);
    }
    return model;
  }

  function telemetryOf(caller: Caller, functionId: string, sessionId?: string) {
    return d.telemetry.options({
      functionId,
      ...(isSystemCaller(caller) ? {} : { userId: caller.userId }),
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  }

  async function extract<T>(caller: Caller, request: ExtractRequest<T>): Promise<T> {
    const model = await languageModel(caller, request.task);
    const call = () =>
      generateText({
        model,
        system: request.instructions,
        prompt: `<document>\n${request.document}\n</document>`,
        output: Output.object({ schema: request.schema }),
        ...telemetryOf(caller, request.task),
      });
    for (let attempt = 1; ; attempt += 1) {
      try {
        return (await call()).output;
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        // LLM-04: ответ не по схеме — один повтор; дальше — ошибка, а не «примерно похоже».
        if (attempt >= 2) throw new LlmSchemaError(`Ответ модели не по схеме (${request.task}).`);
      }
    }
  }

  async function recordSide(
    task: string,
    record: StoredModel,
    started: number,
    tokens: number,
    error: unknown,
  ) {
    await meter
      .record({
        task,
        provider: record.provider,
        model: record.modelId,
        inputTokens: tokens,
        outputTokens: 0,
        ms: Math.round(performance.now() - started),
        costMicros: costMicros({ input: tokens, output: 0 }, record),
        errorCode: error === undefined ? null : errorCodeOf(error),
        createdAt: d.clock.now(),
      })
      .catch((failure: unknown) =>
        d.log.warn({ err: failure, code: "LLM_USAGE" }, "llm.usage-failed"),
      );
  }

  return {
    async model(caller, task, call = {}) {
      return {
        model: await languageModel(caller, task),
        telemetry: telemetryOf(caller, task, call.sessionId),
      };
    },
    extract,
    async classify(caller, request) {
      const { label } = await extract(caller, {
        task: request.task,
        schema: z.object({ label: z.enum(request.labels) }),
        instructions: request.instructions,
        document: request.text,
        promptVersion: request.promptVersion,
      });
      return label;
    },
    async embed(caller, texts) {
      assertOutsideTransaction();
      const [record] = await chainFor(caller, "embed");
      const model =
        record === undefined ? undefined : adapterOf(record).embeddingModel?.(record.modelId);
      if (record === undefined || model === undefined) throw new AppError("UNAVAILABLE");
      const started = performance.now();
      try {
        const { embeddings, usage } = await embedMany({
          model,
          values: [...texts],
          ...telemetryOf(caller, "embed"),
        });
        // Не все модели векторов сообщают токены: тогда 0, а не NaN в журнале.
        const tokens = Number.isFinite(usage.tokens) ? usage.tokens : 0;
        await recordSide("embed", record, started, tokens, undefined);
        return embeddings;
      } catch (error) {
        await recordSide("embed", record, started, 0, error);
        throw error;
      }
    },
    async transcribe(caller, audio) {
      assertOutsideTransaction();
      const [record] = await chainFor(caller, "transcribe");
      const model =
        record === undefined ? undefined : adapterOf(record).transcriptionModel?.(record.modelId);
      if (record === undefined || model === undefined) throw new AppError("UNAVAILABLE");
      const started = performance.now();
      try {
        const { text } = await transcribe({
          model,
          audio,
          ...telemetryOf(caller, "transcribe"),
        });
        await recordSide("transcribe", record, started, 0, undefined);
        return text;
      } catch (error) {
        await recordSide("transcribe", record, started, 0, error);
        throw error;
      }
    },
  };
}
