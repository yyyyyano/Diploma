// Порт трасс ИИ (OBS-03, ADR-0010): опции telemetry вызова AI SDK с functionId, внутренним userId и sessionId
// (id диалога). userId и sessionId идут в runtimeContext вызова и включаются в трассу явно (includeRuntimeContext):
// без явного включения AI SDK контекст в трассы не пишет. Куда уходят трассы — Langfuse (target): интеграцию
// OpenTelemetry строит шлюз llm (@ai-sdk/otel + @langfuse/otel), платформа AI SDK не знает. Без target трассы
// выключены — приложение работает и без Langfuse.
import { readFile } from "node:fs/promises";
import type { LangfuseConfig } from "../config/config.ts";
import type { Logger } from "../logging/logger.ts";

/** Что известно о вызове: задача и, если есть, чей он и какой диалог. */
export interface TelemetryCall {
  /** Имя функции в трассах: задача шлюза (`chat`, `receipt.extract`). */
  readonly functionId: string;
  /** Внутренний id пользователя (не email). */
  readonly userId?: string;
  /** Id диалога чата. */
  readonly sessionId?: string;
}

/** Опции вызова AI SDK: `telemetry` и `runtimeContext` с теми полями, что попадут в трассу. */
export interface TelemetryCallOptions {
  readonly telemetry: {
    readonly isEnabled: boolean;
    readonly functionId: string;
    readonly includeRuntimeContext: { readonly userId: true; readonly sessionId: true };
  };
  readonly runtimeContext: { readonly userId?: string; readonly sessionId?: string };
}

/**
 * Куда слать трассы: Langfuse проекта. Секретный ключ — функцией, а не полем: объект порта не выдаст его ни в JSON,
 * ни в util.inspect (NFR-16).
 */
export interface LangfuseTarget {
  readonly baseUrl: string;
  readonly publicKey: string;
  secretKey(): string;
}

export interface Telemetry {
  readonly enabled: boolean;
  /** Langfuse, если трассы включены. */
  readonly langfuse: LangfuseTarget | undefined;
  options(call: TelemetryCall): TelemetryCallOptions;
}

/** Трассы включены, если есть куда их слать. */
export function createTelemetry(langfuse?: LangfuseTarget): Telemetry {
  const enabled = langfuse !== undefined;
  return {
    enabled,
    langfuse,
    options: ({ functionId, userId, sessionId }) => ({
      telemetry: {
        isEnabled: enabled,
        functionId,
        includeRuntimeContext: { userId: true, sessionId: true },
      },
      runtimeContext: {
        ...(userId === undefined ? {} : { userId }),
        ...(sessionId === undefined ? {} : { sessionId }),
      },
    }),
  };
}

/**
 * Ключи Langfuse из файлов конфигурации (их создаёт make init). Нет файла или он пуст — трассы выключены, в логе
 * telemetry.langfuse-off с причиной (без путей и значений); приложение работает дальше (ADR-0010).
 */
export async function loadLangfuseTarget(
  config: LangfuseConfig | undefined,
  log: Logger,
): Promise<LangfuseTarget | undefined> {
  if (config === undefined) return undefined;
  const read = async (file: string) => (await readFile(file, "utf8").catch(() => "")).trim();
  const [publicKey, secretKey] = await Promise.all([
    read(config.publicKeyFile),
    read(config.secretKeyFile),
  ]);
  if (publicKey === "" || secretKey === "") {
    log.warn({ reason: "LANGFUSE_KEYS_MISSING" }, "telemetry.langfuse-off");
    return undefined;
  }
  return { baseUrl: config.baseUrl, publicKey, secretKey: () => secretKey };
}
