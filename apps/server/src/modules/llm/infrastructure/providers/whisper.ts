// Адаптер whisper.cpp (VOICE-03, ADR-0011): локальное распознавание речи на этом компьютере — whisper-server из Compose
// (профиль models, порт 127.0.0.1:8143). AI SDK умеет транскрипцию только у облачных пакетов, поэтому модель написана
// здесь по спецификации TranscriptionModelV4: POST /inference (multipart: `file`, `response_format=json`) → `{ text }`.
// Сервер без ffmpeg понимает только WAV, MP3 и FLAC: сайт сам кодирует запись в WAV 16 кГц моно (T-043). Язык
// определяется по звуку (`-l auto` в compose.yaml: русский и белорусский). Адрес — настройка, ключа нет.
import type { TranscriptionModelV4, TranscriptionModelV4CallOptions } from "@ai-sdk/provider";
import { z } from "zod";
import type { ProviderAdapter } from "./provider-adapter.ts";
import { RemoteStatusError } from "./remote-fetch.ts";

export const WHISPER_PROVIDER_ID = "whisper";

/** Срок распознавания одной записи (≤ 60 с звука): на процессоре large-v3-turbo-q5 идёт заметно дольше реального времени. */
const INFERENCE_TIMEOUT_MS = 180_000;

const InferenceReply = z.object({ text: z.string() });

/** Расширение имени файла по типу данных: whisper-server выбирает декодер по содержимому, имя — только для порядка. */
function fileNameOf(mediaType: string): string {
  if (mediaType.includes("mpeg") || mediaType.includes("mp3")) return "audio.mp3";
  if (mediaType.includes("flac")) return "audio.flac";
  return "audio.wav";
}

function bytesOf(audio: TranscriptionModelV4CallOptions["audio"]): Uint8Array<ArrayBuffer> {
  const source = typeof audio === "string" ? Buffer.from(audio, "base64") : audio;
  // Blob принимает только ArrayBuffer-представление: копия снимает вопрос про SharedArrayBuffer.
  return new Uint8Array(source);
}

export function createWhisperAdapter(d: {
  readonly baseUrl: () => Promise<string>;
  readonly fetch?: typeof fetch;
}): ProviderAdapter {
  const send = d.fetch ?? fetch;
  const transcriptionModel = (modelId: string): TranscriptionModelV4 => ({
    specificationVersion: "v4",
    provider: WHISPER_PROVIDER_ID,
    modelId,
    async doGenerate({ audio, mediaType, abortSignal }) {
      const form = new FormData();
      form.set("file", new Blob([bytesOf(audio)], { type: mediaType }), fileNameOf(mediaType));
      form.set("response_format", "json");
      const base = (await d.baseUrl()).replace(/\/+$/, "");
      const signal =
        abortSignal === undefined
          ? AbortSignal.timeout(INFERENCE_TIMEOUT_MS)
          : AbortSignal.any([abortSignal, AbortSignal.timeout(INFERENCE_TIMEOUT_MS)]);
      const response = await send(`${base}/inference`, { method: "POST", body: form, signal });
      if (!response.ok) throw new RemoteStatusError(response.status);
      const { text } = InferenceReply.parse(await response.json());
      return {
        text: text.trim(),
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        response: { timestamp: new Date(), modelId },
      };
    },
  });
  return {
    id: WHISPER_PROVIDER_ID,
    cloud: false,
    languageModel: () => {
      // Речь — единственная возможность записей этого провайдера: чат им не отвечает.
      throw new Error("whisper.cpp не отвечает на чат.");
    },
    transcriptionModel,
    isConfigured: async () => true,
  };
}
