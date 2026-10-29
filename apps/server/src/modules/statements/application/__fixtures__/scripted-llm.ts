// Сценарная «модель» для тестов разбора выписок: двойник порта extract шлюза llm. Отвечает заранее заданным ответом
// на задачу, проверяя его схемой запроса (как шлюз проверяет ответ модели, LLM-04), и записывает вызовы — по ним тест
// видит, звали ли модель и что именно ей ушло. Реальные модели в обычных тестах не вызываются (NFR-11, QA-01).
import type { Settings, SettingDef } from "../../../../platform/settings/settings.ts";
import type { LlmFacade } from "../../../llm/index.ts";

export interface ScriptedCall {
  /** Кто звал: scope пользователя (цепочка учитывает облачное согласие) или вызов системы. */
  readonly caller: unknown;
  readonly task: string;
  readonly instructions: string;
  readonly document: string;
  readonly images: number;
}

export interface ScriptedLlm {
  readonly llm: Pick<LlmFacade, "extract">;
  readonly calls: ScriptedCall[];
}

/** answers: ответ по имени задачи (`statement.columns`, `statement.scan`); нет ответа — тест уронит вызов. */
export function scriptedLlm(answers: Readonly<Record<string, unknown>>): ScriptedLlm {
  const calls: ScriptedCall[] = [];
  return {
    calls,
    llm: {
      extract: async (caller, request) => {
        calls.push({
          caller,
          task: request.task,
          instructions: request.instructions,
          document: request.document,
          images: request.images?.length ?? 0,
        });
        if (!(request.task in answers)) {
          throw new Error(`сценарий не знает ответа на задачу ${request.task}`);
        }
        return request.schema.parse(answers[request.task]);
      },
    },
  };
}

/** Настройки с умолчаниями: админка и окружение в тесте не участвуют. */
export const defaultSettings: Settings = {
  get: async <T>(def: SettingDef<T>) => def.default,
  peek: <T>(def: SettingDef<T>) => def.default,
  source: async () => "default",
  set: async () => {},
  reset: async () => {},
};
