// Процедуры voice (contract.voice.*): тонко — authed (сессия) → сценарий. Распознавание не отдаёт чужого: вход — только
// запись самого пользователя, результат — её текст.
import { authed } from "../../../platform/http/procedures.ts";
import type { makeTranscribeRecording } from "../application/transcribe.ts";

export interface VoiceUseCases {
  readonly transcribe: ReturnType<typeof makeTranscribeRecording>;
}

export function voiceRouter(uc: VoiceUseCases) {
  return {
    transcribe: authed.voice.transcribe.handler(({ input, context }) =>
      uc.transcribe(context.s, input.audio),
    ),
  };
}
