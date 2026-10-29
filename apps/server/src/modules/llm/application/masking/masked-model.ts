// Обёртка облачной модели (PRIV-03, PRIV-04, ADR-0009): промпт — с метками вместо личных данных и изображениями без
// метаданных; ответ — с настоящими значениями: текст, поток (метка может прийти кусками) и аргументы инструментов,
// чтобы цикл агента видел и исполнял настоящее. Оборачиваются только облачные модели цепочки и только когда вызывает
// пользователь (scope); задача без данных пользователя (PRIV-09) личных данных не несёт.
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { Scope } from "@kosht/kernel";
import type { Masker } from "./ports.ts";
import { maskPrompt, unmaskContent, unmaskToolInput, type SanitizeFile } from "./prompt.ts";
import { createStreamUnmasker, jsonEscaped, plain } from "./stream-unmasker.ts";

export interface MaskedModelDeps {
  readonly masker: Masker;
  readonly scope: Scope;
  readonly sanitizeFile: SanitizeFile;
}

export function maskedModel(model: LanguageModelV4, d: MaskedModelDeps): LanguageModelV4 {
  async function prepare(prompt: Parameters<LanguageModelV4["doGenerate"]>[0]["prompt"]) {
    const session = d.masker.session(d.scope);
    return {
      session,
      prompt: await maskPrompt(prompt, (text) => session.mask(text), d.sanitizeFile),
    };
  }
  return {
    specificationVersion: "v4",
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(options) {
      const { session, prompt } = await prepare(options.prompt);
      const result = await model.doGenerate({ ...options, prompt });
      return {
        ...result,
        content: unmaskContent(
          result.content,
          plain(session.replacements),
          jsonEscaped(session.replacements),
        ),
      };
    },
    async doStream(options) {
      const { session, prompt } = await prepare(options.prompt);
      const result = await model.doStream({ ...options, prompt });
      const text = plain(session.replacements);
      const json = jsonEscaped(session.replacements);
      // По одному демаскировщику на блок (id): куски разных блоков не смешиваются.
      const unmaskers = new Map<string, ReturnType<typeof createStreamUnmasker>>();
      const unmasker = (kind: string, id: string, replace = text) => {
        const key = `${kind}:${id}`;
        let found = unmaskers.get(key);
        if (found === undefined) {
          found = createStreamUnmasker(replace);
          unmaskers.set(key, found);
        }
        return found;
      };
      const delta = (
        part: LanguageModelV4StreamPart,
        kind: "text" | "reasoning" | "tool-input",
        id: string,
        chunk: string,
        replace = text,
      ): LanguageModelV4StreamPart[] => {
        const ready = unmasker(kind, id, replace).push(chunk);
        return ready === "" ? [] : [{ ...part, delta: ready } as LanguageModelV4StreamPart];
      };
      const closing = (
        kind: "text" | "reasoning" | "tool-input",
        id: string,
        deltaType: "text-delta" | "reasoning-delta" | "tool-input-delta",
        end: LanguageModelV4StreamPart,
        replace = text,
      ): LanguageModelV4StreamPart[] => {
        const rest = unmasker(kind, id, replace).flush();
        return rest === ""
          ? [end]
          : [{ type: deltaType, id, delta: rest } as LanguageModelV4StreamPart, end];
      };
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              const out: LanguageModelV4StreamPart[] = (() => {
                switch (part.type) {
                  case "text-delta":
                    return delta(part, "text", part.id, part.delta);
                  case "text-end":
                    return closing("text", part.id, "text-delta", part);
                  case "reasoning-delta":
                    return delta(part, "reasoning", part.id, part.delta);
                  case "reasoning-end":
                    return closing("reasoning", part.id, "reasoning-delta", part);
                  case "tool-input-delta":
                    return delta(part, "tool-input", part.id, part.delta, json);
                  case "tool-input-end":
                    return closing("tool-input", part.id, "tool-input-delta", part, json);
                  case "tool-call":
                    return [{ ...part, input: unmaskToolInput(part.input, json, text) }];
                  default:
                    return [part];
                }
              })();
              for (const item of out) controller.enqueue(item);
            },
          }),
        ),
      };
    },
  };
}
