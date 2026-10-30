// Сценарная «модель» для тестов распознавания чека: двойник порта extract шлюза llm. Отвечает по очереди заранее
// заданными ответами (первый — чтение чека, дальше — перепроверки), проверяя каждый схемой запроса, как шлюз проверяет
// ответ модели (LLM-04), и записывает вызовы — по ним тест видит, что именно ушло модели. Реальные модели в обычных
// тестах не вызываются (NFR-11, QA-01). Ответ-функция получает номер вызова и может заглянуть в базу или бросить ошибку.
import type { Settings, SettingDef } from "../../../platform/settings/settings.ts";
import type { LlmFacade } from "../../llm/index.ts";

export interface ScriptedCall {
  readonly caller: unknown;
  readonly task: string;
  readonly instructions: string;
  readonly document: string;
  readonly promptVersion: string;
  readonly images: readonly { readonly mediaType: string; readonly bytes: number }[];
}

/** Ответ: значение или функция вызова (может заглянуть в базу, бросить ошибку или вернуть значение позже). */
export type Answer = object | ((index: number) => unknown);

export interface ScriptedLlm {
  readonly llm: Pick<LlmFacade, "extract">;
  readonly calls: ScriptedCall[];
}

export function scriptedLlm(answers: readonly Answer[]): ScriptedLlm {
  const calls: ScriptedCall[] = [];
  return {
    calls,
    llm: {
      extract: async (caller, request) => {
        const index = calls.length;
        calls.push({
          caller,
          task: request.task,
          instructions: request.instructions,
          document: request.document,
          promptVersion: request.promptVersion,
          images: (request.images ?? []).map((image) => ({
            mediaType: image.mediaType,
            bytes: image.data.byteLength,
          })),
        });
        const answer = answers[index] ?? answers.at(-1);
        if (answer === undefined) throw new Error("сценарий не знает ответа на вызов модели");
        const value = typeof answer === "function" ? await answer(index) : answer;
        return request.schema.parse(value);
      },
    },
  };
}

/** Настройки с умолчаниями и точечными подменами по ключу: админка и окружение в тесте не участвуют. */
export function testSettings(overrides: Readonly<Record<string, unknown>> = {}): Settings {
  return {
    get: async <T>(def: SettingDef<T>) => (overrides[def.key] ?? def.default) as T,
    peek: <T>(def: SettingDef<T>) => (overrides[def.key] ?? def.default) as T,
    source: async () => "default",
    set: async () => {},
    reset: async () => {},
  };
}
