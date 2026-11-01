// Голос на сайте (VOICE-02, VOICE-03, SEC-03): запись с микрофона → текст в поле ввода. Сайт сам кодирует запись в WAV
// 16 кГц моно ≤ 60 с (whisper-server без ffmpeg понимает только WAV, MP3, FLAC); тип и длину сервер проверяет по
// заголовку файла, а не по имени и заявленному типу. Распознавание — облако при согласии, иначе whisper.cpp.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Предел записи: 60 с моно 16 кГц 16 бит — около 1,9 МБ; запас на заголовок и стерео. */
export const VOICE_MAX_BYTES = 4_000_000;
/** Предел длительности записи, секунд (VOICE-02). */
export const VOICE_MAX_SECONDS = 60;

export const Transcript = z.strictObject({ text: z.string().max(4000) });
export type Transcript = z.infer<typeof Transcript>;

export const voiceContract = {
  /**
   * Распознать запись: multipart/form-data с полем `audio` (WAV). Не WAV или не 16 кГц — FILE_TYPE_NOT_ALLOWED, длиннее
   * 60 с или больше 4 МБ — FILE_TOO_LARGE, превышение частоты — RATE_LIMITED, нет ни одной модели речи — UNAVAILABLE.
   */
  transcribe: oc
    .route({ method: "POST", path: "/voice/transcribe" })
    .input(z.strictObject({ audio: z.file() }))
    .output(Transcript)
    .errors(
      pickErrors(
        "UNAUTHORIZED",
        "VALIDATION",
        "FILE_TOO_LARGE",
        "FILE_TYPE_NOT_ALLOWED",
        "RATE_LIMITED",
        "UNAVAILABLE",
      ),
    ),
};
