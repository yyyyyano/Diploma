// Трассы ИИ в Langfuse (ADR-0010, OBS-03, T-011): интеграция OpenTelemetry AI SDK 7 (@ai-sdk/otel) пишет спаны
// вызова — операция (invoke_agent <задача>), шаги, вызовы модели, инструменты — в свой провайдер трассировки, а
// процессор @langfuse/otel отправляет их в Langfuse пачками. Интеграция передаётся вызову (telemetry.integrations),
// а не регистрируется глобально (registerTelemetry): шлюз решает сам, и выключенный Langfuse не оставляет следов.
// userId (внутренний id, не email) и sessionId (id диалога) — атрибуты user.id и session.id: по ним Langfuse
// группирует трассы пользователя и диалога (R46).
import { OpenTelemetry } from "@ai-sdk/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import type { Attributes } from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { Telemetry as AiTelemetry } from "ai";
import type { LangfuseTarget } from "../../../../platform/telemetry/telemetry.ts";
import { maskingSpanProcessor } from "./masking-span-processor.ts";

export interface LangfuseTracing {
  /** Интеграция для опций вызова AI SDK (telemetry.integrations). */
  readonly integration: AiTelemetry;
  /** Дослать накопленные спаны и остановить провайдер (остановка модуля llm). */
  shutdown(): Promise<void>;
}

export interface LangfuseTracingOptions {
  /** Свой экспортёр вместо OTLP в Langfuse — тесты (InMemorySpanExporter). */
  readonly exporter?: SpanExporter;
  /**
   * Маска значений спанов (PRIV-03): синхронная, по одному атрибуту; в Langfuse уходит замаскированное. Без неё тексты
   * запросов попали бы в трассы открытым текстом — модуль llm всегда передаёт маску.
   */
  readonly mask?: (params: { data: unknown }) => unknown;
}

/** Атрибуты пользователя и диалога из runtimeContext вызова (его наполняет порт platform/telemetry). */
export function traceAttributes(runtimeContext: Record<string, unknown> | undefined): Attributes {
  const attributes: Attributes = {};
  const userId = runtimeContext?.["userId"];
  const sessionId = runtimeContext?.["sessionId"];
  if (typeof userId === "string") attributes["user.id"] = userId;
  if (typeof sessionId === "string") attributes["session.id"] = sessionId;
  return attributes;
}

export function createLangfuseTracing(
  target: LangfuseTarget,
  options: LangfuseTracingOptions = {},
): LangfuseTracing {
  const processor = new LangfuseSpanProcessor({
    baseUrl: target.baseUrl,
    publicKey: target.publicKey,
    secretKey: target.secretKey(),
    exportMode: "batched",
    // Недоступный Langfuse не держит остановку процесса: срок остановки — 10 с на всё (ADR-0015).
    timeout: 2,
    // Картинки чеков в трассы не выгружаются отдельными файлами: Langfuse хранит их только как часть запроса.
    mediaUploadEnabled: false,
    ...(options.mask === undefined ? {} : { mask: options.mask }),
    ...(options.exporter === undefined ? {} : { exporter: options.exporter }),
  });
  // Маскирующий процессор — первым: к Langfuse спан доходит уже без личных данных (PRIV-03).
  const provider = new NodeTracerProvider({
    spanProcessors: [
      ...(options.mask === undefined ? [] : [maskingSpanProcessor(options.mask)]),
      processor,
    ],
  });
  // register() ставит менеджер контекста на AsyncLocalStorage: без него спаны шагов и инструментов не вкладываются в
  // спан операции. Глобальный провайдер больше никто не читает — интеграция получает свой tracer явно.
  provider.register();
  const integration = new OpenTelemetry({
    tracer: provider.getTracer("kosht-llm"),
    agentSpanName: "functionId",
    runtimeContext: true,
    enrichSpan: ({ runtimeContext }) => traceAttributes(runtimeContext),
  });
  return { integration, shutdown: async () => provider.shutdown() };
}
