// Transcriber поверх шлюза (VOICE-03): цепочка задачи `transcribe` — Groq Whisper при облачном согласии, затем
// whisper.cpp; `caller` (scope пользователя) нужен шлюзу для согласия и журнала расхода. Аудио не маскируется: текста
// в нём нет, а облако доступно только при согласии на голосовые сообщения (PRIV-02).
import type { Caller } from "../domain/caller.ts";
import type { LlmGateway } from "./gateway.ts";
import type { Transcriber } from "./ports.ts";

export function gatewayTranscriber(
  llm: Pick<LlmGateway, "transcribe">,
  caller: Caller,
): Transcriber {
  return { transcribe: (audio) => llm.transcribe(caller, audio) };
}
