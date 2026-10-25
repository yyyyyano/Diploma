// Модуль voice (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface VoiceFacades {
  readonly llm: LlmFacade;
}

export function createVoiceModule(_deps: ModuleDeps<VoiceFacades, Platform>) {
  return defineModule({ id: "voice" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type VoiceFacade = ReturnType<typeof createVoiceModule>["facade"];
