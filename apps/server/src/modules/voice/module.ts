// Модуль voice (паспорт — CLAUDE.md): запись → текст на сайте (VOICE-02) и фасад для бота (VOICE-01, T-052).
// Распознавание — через шлюз llm: облако при согласии, иначе или при недоступности — whisper.cpp (VOICE-03).
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";
import { voiceRouter } from "./api/router.ts";
import { makeTranscribeMessage } from "./application/transcribe-message.ts";
import { makeTranscribeRecording } from "./application/transcribe.ts";
import { VOICE_SETTINGS } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface VoiceFacades {
  readonly llm: LlmFacade;
}

export function createVoiceModule({ platform, facades }: ModuleDeps<VoiceFacades, Platform>) {
  return defineModule({
    id: "voice",
    router: voiceRouter({
      transcribe: makeTranscribeRecording({ llm: facades.llm, platform }),
    }),
    facade: {
      /** Текст голосового сообщения бота (OGG/Opus или WAV): частота, размер и тип проверяются, как у процедуры сайта. */
      transcribe: makeTranscribeMessage({ llm: facades.llm, platform }),
    },
    settings: VOICE_SETTINGS,
  });
}

/** Что модуль даёт соседям: распознавание записи. */
export type VoiceFacade = ReturnType<typeof createVoiceModule>["facade"];
