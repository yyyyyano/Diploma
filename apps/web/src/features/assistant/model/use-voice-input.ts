// Голосовой ввод (VOICE-02, VOICE-03): запись с микрофона → WAV 16 кГц моно → `voice.transcribe` → текст в поле для
// правки (по умолчанию не отправляется). Работает только на localhost (`micMode`); запись ограничена минутой. Звук
// остаётся в памяти вкладки: на диск и в `localStorage` не пишется. Браузерные части подменяемы для тестов.
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import {
  browserAudioEnv,
  MAX_SECONDS,
  micMode,
  recordingToWav,
  type AudioEnv,
  type MicMode,
} from "./wav-encoder.ts";

export type VoiceStatus = "idle" | "recording" | "working";
export type VoiceError =
  | "denied"
  | "unsupported"
  | "empty"
  | "tooLong"
  | "failed"
  | "unavailable"
  | "rateLimited";

export interface VoiceInput {
  readonly mode: MicMode;
  readonly status: VoiceStatus;
  readonly error: VoiceError | undefined;
  /** Минуты ожидания при `rateLimited`. */
  readonly retryAfterMinutes: number;
  readonly start: () => void;
  readonly stop: () => void;
  readonly clearError: () => void;
}

export interface VoiceDeps {
  readonly hostname: string;
  readonly mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined;
  readonly recorder: typeof MediaRecorder | undefined;
  readonly audio: () => AudioEnv;
  readonly transcribe: (wav: Uint8Array) => Promise<string>;
  readonly maxSeconds: number;
}

export function browserVoiceDeps(): VoiceDeps {
  return {
    hostname: window.location.hostname,
    mediaDevices: typeof navigator === "undefined" ? undefined : navigator.mediaDevices,
    recorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    audio: browserAudioEnv,
    transcribe: async (wav) => {
      const audio = new File([wav as BlobPart], "voice.wav", { type: "audio/wav" });
      return (await client.voice.transcribe({ audio })).text;
    },
    maxSeconds: MAX_SECONDS,
  };
}

/** Код ошибки сервера → ключ текста `assistant:voice.<ключ>`. */
function voiceErrorOf(error: unknown): VoiceError {
  switch (errorCodeOf(error)) {
    case "FILE_TOO_LARGE":
      return "tooLong";
    case "RATE_LIMITED":
      return "rateLimited";
    case "UNAVAILABLE":
      return "unavailable";
    default:
      return "failed";
  }
}

export function useVoiceInput(options: {
  readonly onText: (text: string) => void;
  readonly deps?: VoiceDeps;
}): VoiceInput {
  const [deps] = useState(() => options.deps ?? browserVoiceDeps());
  const mode = micMode({ hostname: deps.hostname, hasRecorder: deps.recorder !== undefined });
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<VoiceError | undefined>();
  const [retryAfterMinutes, setRetryAfterMinutes] = useState(1);
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onText = useRef(options.onText);
  useEffect(() => {
    onText.current = options.onText;
  });

  const release = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = undefined;
  }, []);

  useEffect(() => release, [release]);

  const finish = useCallback(
    async (recording: Blob) => {
      setStatus("working");
      try {
        const verdict = await recordingToWav(recording, deps.audio());
        if (verdict.kind === "silent") return setError("empty");
        if (verdict.kind === "too-long") return setError("tooLong");
        const text = (await deps.transcribe(verdict.wav)).trim();
        if (text === "") return setError("empty");
        onText.current(text);
      } catch (failure) {
        const known = voiceErrorOf(failure);
        if (known === "rateLimited") setRetryAfterMinutes(errorParamsOf(failure).retryAfterMinutes);
        setError(known);
      } finally {
        setStatus("idle");
      }
    },
    [deps],
  );

  const start = useCallback(() => {
    if (status !== "idle" || deps.recorder === undefined || deps.mediaDevices === undefined) return;
    setError(undefined);
    const Recorder = deps.recorder;
    void deps.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new Recorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          const type = recorder.mimeType;
          release();
          void finish(new Blob(chunks, { type }));
        };
        recorderRef.current = recorder;
        recorder.start();
        setStatus("recording");
        // VOICE-02: запись длиннее минуты сервер всё равно отвергнет — останавливаем сами.
        timerRef.current = setTimeout(
          () => recorder.state !== "inactive" && recorder.stop(),
          deps.maxSeconds * 1000,
        );
      })
      .catch(() => setError("denied"));
  }, [deps, finish, release, status]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder !== undefined && recorder.state !== "inactive") recorder.stop();
  }, []);

  return {
    mode,
    status,
    error,
    retryAfterMinutes,
    start,
    stop,
    clearError: () => setError(undefined),
  };
}
