// Голосовое сообщение бота → текст (VOICE-01, TG-05): те же проверки, что у записи с сайта (частота SEC-02, размер и тип
// по заголовку SEC-03), но формат — OGG/Opus Telegram: whisper принимает его без перекодирования, а WAV остаётся для
// тестов и записей с сайта. Модель зовётся вне транзакции. Текст — не в лог (OBS-04).
import { VOICE_MAX_BYTES } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { gatewayTranscriber } from "../../llm/index.ts";
import { judgeRecording } from "../domain/wav.ts";
import { enforceRate, TEXT_MAX, type VoiceDeps } from "./transcribe.ts";

const startsWith = (bytes: Uint8Array, magic: string): boolean =>
  bytes.byteLength >= magic.length &&
  magic.split("").every((char, at) => bytes[at] === char.charCodeAt(0));

export function makeTranscribeMessage(d: VoiceDeps) {
  return async function transcribeMessage(s: ScopedDb, audio: Uint8Array): Promise<string> {
    await enforceRate(d.platform, s.scope.userId);
    if (audio.byteLength > VOICE_MAX_BYTES)
      throw new AppError("FILE_TOO_LARGE", { name: "запись" });
    if (!startsWith(audio, "OggS") && !judgeRecording(audio).ok) {
      throw new AppError("FILE_TYPE_NOT_ALLOWED", { name: "запись" });
    }
    const started = performance.now();
    const text = await gatewayTranscriber(d.llm, s.scope).transcribe(audio);
    d.platform.log.info({ ms: Math.round(performance.now() - started) }, "voice.transcribed");
    return text.trim().slice(0, TEXT_MAX);
  };
}
