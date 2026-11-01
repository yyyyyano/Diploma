// Запись с микрофона → WAV 16 кГц моно (VOICE-02): whisper-server без ffmpeg понимает только WAV, MP3 и FLAC, а
// MediaRecorder в Chrome и Firefox даёт webm/opus, в Safari — mp4. Поэтому сайт сам декодирует запись
// (`decodeAudioData`), пересчитывает в 16 кГц моно через `OfflineAudioContext` (его фильтр не даёт «ряби» при
// понижении частоты) и пишет заголовок WAV. Браузерные части подменяемы (`AudioEnv`): тесты идут без звука.

export const TARGET_RATE = 16_000;
/** Предел записи, секунд (VOICE-02): сервер отвергает длиннее. */
export const MAX_SECONDS = 60;
/** Тише этого пика (доля от полной шкалы) запись считается тишиной: на распознавание она не уходит. */
const SILENCE_PEAK = 0.01;

/** PCM 16 бит моно с заголовком WAV; значения вне −1…1 обрезаются. */
export function encodeWav(samples: Float32Array, sampleRate: number = TARGET_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // моно
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff)), true);
  });
  return bytes;
}

/** Запись без речи: пик тише порога (или пустая). */
export function isSilent(samples: Float32Array): boolean {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak < SILENCE_PEAK;
}

/** Декодированное аудио в объёме, нужном кодировщику. */
export interface DecodedAudio {
  readonly duration: number;
}

/** Браузерные части: декодирование и пересчёт в 16 кГц моно. */
export interface AudioEnv {
  decode(data: ArrayBuffer): Promise<DecodedAudio>;
  /** Пересчитать в `TARGET_RATE` моно; длина результата — по длительности записи. */
  resample(audio: DecodedAudio): Promise<Float32Array>;
}

/** Настоящие AudioContext и OfflineAudioContext браузера. */
export function browserAudioEnv(): AudioEnv {
  const buffers = new WeakMap<DecodedAudio, AudioBuffer>();
  return {
    async decode(data) {
      const context = new AudioContext();
      try {
        const buffer = await context.decodeAudioData(data);
        const decoded: DecodedAudio = { duration: buffer.duration };
        buffers.set(decoded, buffer);
        return decoded;
      } finally {
        void context.close();
      }
    },
    async resample(audio) {
      const buffer = buffers.get(audio);
      if (buffer === undefined) throw new Error("запись не декодирована");
      const length = Math.max(1, Math.ceil(buffer.duration * TARGET_RATE));
      const offline = new OfflineAudioContext(1, length, TARGET_RATE);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return rendered.getChannelData(0);
    },
  };
}

export type RecordingVerdict =
  | { readonly kind: "ok"; readonly wav: Uint8Array; readonly seconds: number }
  | { readonly kind: "silent" }
  | { readonly kind: "too-long" };

/** Запись MediaRecorder → WAV для `voice.transcribe`; тишина и запись длиннее минуты не отправляются. */
export async function recordingToWav(
  recording: Blob,
  env: AudioEnv = browserAudioEnv(),
): Promise<RecordingVerdict> {
  const decoded = await env.decode(await recording.arrayBuffer());
  if (decoded.duration > MAX_SECONDS + 0.5) return { kind: "too-long" };
  const samples = await env.resample(decoded);
  if (isSilent(samples)) return { kind: "silent" };
  return { kind: "ok", wav: encodeWav(samples), seconds: decoded.duration };
}

/** Микрофон только на этом компьютере (VOICE-02): getUserMedia нужен безопасный контекст, по сети его нет. */
export type MicMode = "available" | "network" | "unsupported";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function micMode(input: {
  readonly hostname: string;
  readonly hasRecorder: boolean;
}): MicMode {
  if (!LOCAL_HOSTS.has(input.hostname)) return "network";
  return input.hasRecorder ? "available" : "unsupported";
}
