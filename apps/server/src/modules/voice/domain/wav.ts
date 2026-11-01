// Проверка записи по заголовку WAV (VOICE-02, SEC-03): тип узнаётся по содержимому, а не по имени и заявленному типу.
// whisper-server без ffmpeg принимает WAV строго 16 кГц (другой частоты не пересчитывает), поэтому сайт кодирует
// запись сам, а сервер отсекает всё остальное до обращения к модели.
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "@kosht/contract";

export const SAMPLE_RATE = 16_000;

export type RecordingVerdict =
  | { readonly ok: true; readonly seconds: number }
  /** `type` — не WAV того вида, что принимает распознавание; `size` — длиннее предела или больше по размеру. */
  | { readonly ok: false; readonly reason: "type" | "size" };

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** Допуск на округление длительности при кодировании на сайте: 60,0 с записи не должны отвергаться из-за 60,02. */
const SECONDS_TOLERANCE = 0.5;

/** Заголовок RIFF/WAVE: PCM 16 бит, 16 кГц, один или два канала; длительность — по размеру блока `data`. */
export function judgeRecording(bytes: Uint8Array): RecordingVerdict {
  if (bytes.byteLength > VOICE_MAX_BYTES) return { ok: false, reason: "size" };
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return { ok: false, reason: "type" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { channels: number; rate: number; bits: number; format: number } | undefined;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= bytes.byteLength) {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (fmt === undefined) return { ok: false, reason: "type" };
      const pcm = fmt.format === 1 || fmt.format === 0xfffe;
      if (!pcm || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16 || ![1, 2].includes(fmt.channels)) {
        return { ok: false, reason: "type" };
      }
      // Размер блока в заголовке может врать (потоковая запись): верим меньшему из него и фактического остатка.
      const dataBytes = Math.min(size, bytes.byteLength - body);
      const seconds = dataBytes / (SAMPLE_RATE * 2 * fmt.channels);
      if (seconds > VOICE_MAX_SECONDS + SECONDS_TOLERANCE) return { ok: false, reason: "size" };
      return { ok: true, seconds };
    }
    // Блоки выровнены по чётным границам.
    at = body + size + (size % 2);
  }
  return { ok: false, reason: "type" };
}
