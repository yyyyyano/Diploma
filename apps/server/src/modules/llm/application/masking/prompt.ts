// Маскирование промпта и демаскирование ответа (PRIV-03): тексты сообщений, рассуждения, аргументы и результаты
// инструментов — маскируются; изображения (файлы) проходят очистку метаданных, а не маскирование (PRIV-04: изображение
// замаскировать нельзя). Служебное — имена инструментов, id вызовов, типы, `providerOptions` — не трогается.
import type {
  LanguageModelV4Content,
  LanguageModelV4FilePart,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import type { Replace } from "./stream-unmasker.ts";
import { LABEL_PATTERN } from "../../domain/masking/labels.ts";

export type MaskText = (text: string) => Promise<string>;
export type SanitizeFile = (part: LanguageModelV4FilePart) => Promise<LanguageModelV4FilePart>;

/** Все строки значения (не ключи) — через `map`; структура сохраняется. */
export async function mapStrings(
  value: unknown,
  map: (text: string) => Promise<string>,
): Promise<unknown> {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return Promise.all(value.map((item) => mapStrings(item, map)));
  if (typeof value === "object" && value !== null) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await mapStrings(item, map)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

type Part = LanguageModelV4Prompt[number]["content"] extends string
  ? never
  : Exclude<LanguageModelV4Prompt[number]["content"], string>[number];

async function maskOutput(output: unknown, mask: MaskText): Promise<unknown> {
  const out = output as { type?: string; value?: unknown; reason?: string };
  switch (out.type) {
    case "text":
    case "error-text":
      return { ...out, value: await mask(String(out.value)) };
    case "json":
    case "error-json":
      return { ...out, value: await mapStrings(out.value, mask) };
    case "execution-denied":
      return out.reason === undefined ? out : { ...out, reason: await mask(out.reason) };
    case "content":
      return {
        ...out,
        value: await Promise.all(
          (out.value as { type: string; text?: string }[]).map(async (item) =>
            item.type === "text" && item.text !== undefined
              ? { ...item, text: await mask(item.text) }
              : item,
          ),
        ),
      };
    default:
      return output;
  }
}

async function maskPart(part: Part, mask: MaskText, sanitize: SanitizeFile): Promise<Part> {
  switch (part.type) {
    case "text":
    case "reasoning":
      return { ...part, text: await mask(part.text) };
    case "file":
      return sanitize(part);
    case "tool-call":
      return { ...part, input: await mapStrings(part.input, mask) };
    case "tool-result":
      return { ...part, output: (await maskOutput(part.output, mask)) as typeof part.output };
    default:
      return part;
  }
}

/** Промпт для облака: имена, счета, карты и прочее — метками; изображения — без метаданных. */
export async function maskPrompt(
  prompt: LanguageModelV4Prompt,
  mask: MaskText,
  sanitize: SanitizeFile,
): Promise<LanguageModelV4Prompt> {
  const masked: LanguageModelV4Prompt = [];
  for (const message of prompt) {
    if (message.role === "system") {
      masked.push({ ...message, content: await mask(message.content) });
      continue;
    }
    const content = await Promise.all(
      (message.content as Part[]).map((part) => maskPart(part, mask, sanitize)),
    );
    masked.push({ ...message, content } as LanguageModelV4Prompt[number]);
  }
  return masked;
}

/** Аргументы инструмента (JSON-строка) с настоящими значениями: разобрать, подставить в строки, собрать. */
export function unmaskToolInput(input: string, replace: Replace, plain: Replace): string {
  try {
    const parsed: unknown = JSON.parse(input);
    const walk = (value: unknown): unknown => {
      if (typeof value === "string") return value.replace(LABEL_PATTERN, plain);
      if (Array.isArray(value)) return value.map(walk);
      if (typeof value === "object" && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
      }
      return value;
    };
    return JSON.stringify(walk(parsed));
  } catch {
    // Не JSON (обрыв): подставляем экранированные значения прямо в текст.
    return input.replace(LABEL_PATTERN, replace);
  }
}

/** Содержимое ответа с настоящими значениями вместо меток (текст, рассуждения, аргументы инструментов). */
export function unmaskContent(
  content: readonly LanguageModelV4Content[],
  plain: Replace,
  json: Replace,
): LanguageModelV4Content[] {
  return content.map((part) => {
    switch (part.type) {
      case "text":
      case "reasoning":
        return { ...part, text: part.text.replace(LABEL_PATTERN, plain) };
      case "tool-call":
        return { ...part, input: unmaskToolInput(part.input, json, plain) };
      default:
        return part;
    }
  });
}
