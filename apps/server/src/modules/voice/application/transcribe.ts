// Запись → текст (VOICE-02, VOICE-03): ограничение частоты (SEC-02) → проверка записи по заголовку (SEC-03) →
// Transcriber (облако при согласии, иначе whisper.cpp). Текст записи и распознанный текст — не в лог (OBS-04): только
// длительность и время. Модель зовётся вне транзакции (llm бросит LLM_IN_TRANSACTION).
import { VOICE_MAX_BYTES } from "@kosht/contract";
import { gatewayTranscriber } from "../../llm/index.ts";
import type { LlmFacade } from "../../llm/index.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { defineRateRule } from "../../../platform/rate-limit/rate-limit.ts";
import { judgeRecording } from "../domain/wav.ts";
import { VOICE_RATE_PER_DAY, VOICE_RATE_PER_MINUTE } from "../settings.ts";

export interface VoiceDeps {
  readonly llm: Pick<LlmFacade, "transcribe">;
  readonly platform: Pick<Platform, "rateLimiter" | "settings" | "log" | "clock">;
}

async function enforceRate(platform: VoiceDeps["platform"], userId: string): Promise<void> {
  const [perMinute, perDay] = await Promise.all([
    platform.settings.get(VOICE_RATE_PER_MINUTE),
    platform.settings.get(VOICE_RATE_PER_DAY),
  ]);
  // Минутное правило — первым: отказ по нему не съедает суточную квоту.
  await platform.rateLimiter.enforce(
    defineRateRule({ name: "voice.transcribe-minute", limit: perMinute, windowMs: 60_000 }),
    userId,
  );
  await platform.rateLimiter.enforce(
    defineRateRule({ name: "voice.transcribe-day", limit: perDay, windowMs: 86_400_000 }),
    userId,
  );
}

/** Предел текста: поле ввода чата принимает 4000 знаков (SendInput), запись на 60 с столько не даёт. */
const TEXT_MAX = 4000;

/** Распознавание записи с сайта: WAV 16 кГц ≤ 60 с (`contract.voice.transcribe`). */
export function makeTranscribeRecording(d: VoiceDeps) {
  return async function transcribeRecording(
    s: ScopedDb,
    recording: Blob,
  ): Promise<{ text: string }> {
    await enforceRate(d.platform, s.scope.userId);
    // Размер — до чтения содержимого: огромный файл в память не попадает.
    if (recording.size > VOICE_MAX_BYTES) throw new AppError("FILE_TOO_LARGE", { name: "запись" });
    const bytes = new Uint8Array(await recording.arrayBuffer());
    const verdict = judgeRecording(bytes);
    if (!verdict.ok) {
      throw new AppError(verdict.reason === "size" ? "FILE_TOO_LARGE" : "FILE_TYPE_NOT_ALLOWED", {
        name: "запись",
      });
    }
    const started = performance.now();
    const text = await gatewayTranscriber(d.llm, s.scope).transcribe(bytes);
    d.platform.log.info({ ms: Math.round(performance.now() - started) }, "voice.transcribed");
    return { text: text.trim().slice(0, TEXT_MAX) };
  };
}
