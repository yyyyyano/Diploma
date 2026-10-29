// Маскирование атрибутов спанов до отправки в Langfuse (PRIV-03, OBS-03). Интеграция @ai-sdk/otel пишет запрос и
// ответ модели в атрибуты GenAI (gen_ai.input.messages, gen_ai.output.messages…), а встроенная маска процессора
// Langfuse их не видит: она работает только с атрибутами самого Langfuse. Поэтому первым в провайдере стоит этот
// процессор: при завершении спана он прогоняет маской все строковые атрибуты (кроме идентификаторов) на месте, а
// процессор Langfuse, стоящий следом, уже получает замаскированное. Атрибуты спана — объект, который процессоры
// правят на месте (так делает и сам Langfuse), поэтому запись в него — штатный путь.
import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

export type TraceMask = (params: { data: unknown }) => unknown;

/** Идентификаторы пользователя и диалога — по ним Langfuse группирует трассы: маскировать нечего и нельзя. */
const KEEP = /^(?:user\.id|session\.id)$|\.id$/;

export function maskingSpanProcessor(mask: TraceMask): SpanProcessor {
  return {
    onStart(_span: Span, _context: Context): void {},
    onEnd(span: ReadableSpan): void {
      const attributes = span.attributes as Record<string, unknown>;
      for (const key of Object.keys(attributes)) {
        if (!KEEP.test(key)) attributes[key] = mask({ data: attributes[key] });
      }
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  };
}
