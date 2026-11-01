// Шлюз llm (LLM-01, NFR-04, ARCHITECTURE §8.1) — единственный, кто знает провайдеров. Первый аргумент — кто зовёт:
// scope пользователя (цепочка учитывает облачное согласие, PRIV-02) или systemCaller модуля (задача без данных
// пользователя, PRIV-09). Цепочка — из реестра моделей по возможностям задачи (domain/build-chain.ts); каждая модель
// цепочки обёрнута журналом расхода и запретом вызова в транзакции (metered-model.ts). Режим кассет процесса: replay —
// ответы из кассеты, record — запись шагов. Трассы — опции telemetry с functionId, userId и sessionId и интеграцией
// Langfuse, если он включён (infrastructure/telemetry, ADR-0010).
import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  embedMany,
  generateText,
  NoObjectGeneratedError,
  Output,
  transcribe,
  type Telemetry as AiTelemetry,
} from "ai";
import { z } from "zod";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Telemetry, TelemetryCallOptions } from "../../../platform/telemetry/telemetry.ts";
import type { Clock, Scope } from "@kosht/kernel";
import { buildChain } from "../domain/build-chain.ts";
import { prepareDocument } from "../domain/injection.ts";
import { isSystemCaller, type Caller } from "../domain/caller.ts";
import { costMicros } from "../domain/cost.ts";
import type { LlmTask, StructuredTask } from "../domain/tasks.ts";
import {
  insertUsage,
  listChains,
  listModels,
  usageWindows,
  type StoredModel,
} from "../infrastructure/db/llm.repo.ts";
import {
  recordingModel,
  replayModel,
  type CassetteMode,
  type CassetteRef,
} from "../infrastructure/providers/cassettes.ts";
import { sanitizeFilePart } from "../infrastructure/images/strip-metadata.ts";
import type { ProviderRegistry } from "../infrastructure/providers/providers.ts";
import { chainedModel, type ChainEntry, type ChainEvent } from "./chained-model.ts";
import { createLimiter } from "./limiter.ts";
import { LlmSchemaError } from "./errors.ts";
import { maskedModel } from "./masking/masked-model.ts";
import type { Masker } from "./masking/ports.ts";
import type { SanitizeFile } from "./masking/prompt.ts";
import { assertOutsideTransaction, errorCodeOf, meteredModel } from "./metered-model.ts";

/** Опции трасс вызова: порта платформы и интеграции трасс шлюза (Langfuse). */
export interface LlmTelemetryOptions extends TelemetryCallOptions {
  readonly telemetry: TelemetryCallOptions["telemetry"] & {
    readonly integrations?: AiTelemetry[];
  };
}

/** Модель чата для агента: сама модель (цепочка) и опции трасс вызова. */
export interface ChatModel {
  readonly model: LanguageModelV4;
  readonly telemetry: LlmTelemetryOptions;
}

export interface ExtractRequest<T> {
  readonly task: StructuredTask;
  readonly schema: z.ZodType<T>;
  /** Инструкции — отдельно от документа (SEC-10/11). */
  readonly instructions: string;
  /** Документ — данные: уходит блоком <document>, не инструкциями (приказы и теги разметки нейтрализуются, SEC-10). */
  readonly document: string;
  /**
   * Изображения документа (фото чека, скан выписки — файловые части AI SDK). Облачной модели уходят перекодированными
   * без метаданных (PRIV-04); сами изображения не маскируются (PRIV-04, решение пользователя 2026-10-29 для сканов).
   */
  readonly images?: readonly { readonly data: Uint8Array; readonly mediaType: string }[];
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
  /**
   * Маскирование перед облаком (PRIV-03): обязательно — шлюз без маскировщика не соберётся, облачная модель в обход
   * него невозможна. Применяется к облачным записям цепочки, когда вызывает пользователь (scope).
   */
  readonly masker: Masker;
  /** Очистка файловых частей облачного промпта (PRIV-04); по умолчанию — sharp без метаданных. */
  readonly sanitizeFile?: SanitizeFile;
  /** Интеграции трасс AI SDK (Langfuse); пусто — трассы только опциями порта (выключены). */
  readonly integrations?: readonly AiTelemetry[];
  readonly clock: Clock;
  readonly log: Logger;
  readonly cassettes: () => Promise<CassetteConfig>;
  /** Сроки первого куска ответа, мс: облачным и локальным моделям — разные (настройки llm.timeout-*). */
  readonly timeouts: () => Promise<{ readonly cloudMs: number; readonly localMs: number }>;
  /** Выбранная пользователем модель чата (LLM-10, llm_preferences); «Авто» — undefined. */
  readonly preferredModel?: (scope: Scope) => Promise<string | undefined>;
  /** Событие провайдера для администратора: исчерпан лимит или ошибка (уведомление ai-provider, NOTIF-03). */
  readonly onProviderEvent?: (event: ChainEvent) => Promise<void>;
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

  // Лимитёр один на процесс: окна — из журнала, размыкатель и остатки по заголовкам — в памяти (limiter.ts).
  const limiter = createLimiter({
    now: () => d.clock.now(),
    usage: () => usageWindows(d.system, d.clock.now()),
  });

  /** Записи реестра, чей провайдер известен коду и настроен (задан ключ): остальные в цепочку не попадают. */
  async function usable(models: readonly StoredModel[]): Promise<StoredModel[]> {
    const configured = new Map<string, boolean>();
    for (const provider of new Set(models.map((model) => model.provider))) {
      const adapter = d.providers.get(provider);
      configured.set(provider, adapter !== undefined && ((await adapter.isConfigured?.()) ?? true));
    }
    return models.filter((model) => configured.get(model.provider) === true);
  }

  async function chainFor(caller: Caller, task: LlmTask): Promise<StoredModel[]> {
    const [models, chains] = await Promise.all([listModels(d.system), listChains(d.system)]);
    // LLM-10: выбор пользователя действует только в чате, и пока администратор разрешает модель выбирать.
    const choice =
      task === "chat" && !isSystemCaller(caller) ? await d.preferredModel?.(caller) : undefined;
    const preferred = models.find((model) => model.id === choice && model.userSelectable)?.id;
    const order = chains.get(task);
    const chain = buildChain(await usable(models), task, {
      cloudAllowed: await cloudAllowed(caller),
      ...(order === undefined ? {} : { order }),
      ...(preferred === undefined ? {} : { preferred }),
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

  /**
   * Облачная модель — только за маскированием (PRIV-03) и очисткой изображений (PRIV-04). Задача без данных
   * пользователя (systemCaller, PRIV-09) личного не несёт — маскировать нечего; локальные модели данные не отдают.
   */
  function protect(caller: Caller, record: StoredModel, model: LanguageModelV4): LanguageModelV4 {
    if (!record.cloud || isSystemCaller(caller)) return model;
    return maskedModel(model, {
      masker: d.masker,
      scope: caller,
      sanitizeFile: d.sanitizeFile ?? sanitizeFilePart,
    });
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
    const entries: ChainEntry[] = (await chainFor(caller, task)).map((record) => ({
      record,
      model: meteredModel(
        protect(caller, record, adapterOf(record).languageModel(record.modelId)),
        { task, price: record, provider: record.provider, modelId: record.modelId },
        meter,
      ),
    }));
    const timeouts = await d.timeouts();
    const model = chainedModel(entries, {
      limiter,
      timeoutMs: (cloud) => (cloud ? timeouts.cloudMs : timeouts.localMs),
      onEvent: (event) => {
        // Уведомление администратору — побочное дело: ответ пользователю оно не задерживает и не ломает.
        void d.onProviderEvent?.(event).catch((failure: unknown) => {
          d.log.warn({ err: failure, code: "LLM_NOTIFY" }, "llm.notify-failed");
        });
      },
    });
    if (config.mode === "record") {
      if (config.cassette === undefined) throw new AppError("UNAVAILABLE");
      return recordingModel(model, config.cassette);
    }
    return model;
  }

  function telemetryOf(
    caller: Caller,
    functionId: string,
    sessionId?: string,
  ): LlmTelemetryOptions {
    const options = d.telemetry.options({
      functionId,
      ...(isSystemCaller(caller) ? {} : { userId: caller.userId }),
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    const integrations = d.integrations ?? [];
    if (!options.telemetry.isEnabled || integrations.length === 0) return options;
    return { ...options, telemetry: { ...options.telemetry, integrations: [...integrations] } };
  }

  async function extract<T>(caller: Caller, request: ExtractRequest<T>): Promise<T> {
    const model = await languageModel(caller, request.task);
    // SEC-10: приказы в тексте документа заменяются меткой, теги не закрывают блок; в лог — только число замен.
    const prepared = prepareDocument(request.document);
    if (prepared.neutralized > 0) {
      d.log.warn({ count: prepared.neutralized }, "llm.injection-neutralized");
    }
    const document = `<document>\n${prepared.text}\n</document>`;
    const images = request.images ?? [];
    const input =
      images.length === 0
        ? { prompt: document }
        : {
            messages: [
              {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: document },
                  ...images.map((image) => ({
                    type: "file" as const,
                    data: image.data,
                    mediaType: image.mediaType,
                  })),
                ],
              },
            ],
          };
    const call = () =>
      generateText({
        model,
        system: request.instructions,
        ...input,
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
      // VOICE-03: облако при согласии, при его недоступности — локальная модель: цепочка идёт до первой, что ответила.
      let failure: unknown;
      for (const record of await chainFor(caller, "transcribe")) {
        const model = adapterOf(record).transcriptionModel?.(record.modelId);
        if (model === undefined) continue;
        const started = performance.now();
        try {
          // Без повторов: недоступное облако не должно задерживать запасную локальную модель.
          const { text } = await transcribe({
            model,
            audio,
            maxRetries: 0,
            ...telemetryOf(caller, "transcribe"),
          });
          await recordSide("transcribe", record, started, 0, undefined);
          return text;
        } catch (error) {
          await recordSide("transcribe", record, started, 0, error);
          failure = error;
        }
      }
      // Ни одна модель цепочки не ответила: причину видно в журнале расхода, пользователю — «сервис недоступен».
      throw new AppError("UNAVAILABLE", {}, failure === undefined ? {} : { cause: failure });
    },
  };
}
