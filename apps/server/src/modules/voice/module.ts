// Модуль voice (паспорт — CLAUDE.md): запись → текст на сайте (VOICE-02) и фасад для бота (VOICE-01, T-052).
// Распознавание — через шлюз llm: облако при согласии, иначе или при недоступности — whisper.cpp (VOICE-03).
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { ScopedDb } from "../../platform/db/scoped-db.ts";
import { gatewayTranscriber, type LlmFacade } from "../llm/index.ts";
import { voiceRouter } from "./api/router.ts";
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
      /** Текст из записи (WAV, MP3 или FLAC) для сценариев без сайта: голосовые сообщения бота. */
      transcribe: (s: ScopedDb, audio: Uint8Array) =>
        gatewayTranscriber(facades.llm, s.scope).transcribe(audio),
    },
    settings: VOICE_SETTINGS,
  });
}

/** Что модуль даёт соседям: распознавание записи. */
export type VoiceFacade = ReturnType<typeof createVoiceModule>["facade"];
