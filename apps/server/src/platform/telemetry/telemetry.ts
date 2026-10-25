// Порт трасс ИИ (OBS-03, ADR-0010): опции telemetry вызова AI SDK с functionId, внутренним userId и sessionId
// (id диалога). userId и sessionId идут в runtimeContext вызова и включаются в трассу явно (includeRuntimeContext):
// без явного включения AI SDK контекст в трассы не пишет. По умолчанию трассы выключены — приложение работает и без
// Langfuse; включает их подключение Langfuse (T-011), которое регистрирует интеграцию OpenTelemetry в AI SDK.
// Платформа не знает AI SDK: здесь — форма опций, вызов собирает шлюз llm.

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

export interface Telemetry {
  readonly enabled: boolean;
  options(call: TelemetryCall): TelemetryCallOptions;
}

/** Трассы по флагу enabled; без интеграции (Langfuse, T-011) — выключены. */
export function createTelemetry(enabled: boolean): Telemetry {
  return {
    enabled,
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
