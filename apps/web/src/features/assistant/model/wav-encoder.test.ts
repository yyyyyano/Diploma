// VOICE-02: кодирование записи в WAV 16 кГц моно, тишина не отправляется, микрофон только на localhost.
import { describe, expect, it } from "vitest";
import {
  encodeWav,
  isSilent,
  micMode,
  recordingToWav,
  TARGET_RATE,
  type AudioEnv,
} from "./wav-encoder.ts";

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

describe("VOICE-02: WAV 16 кГц моно", () => {
  it("заголовок RIFF/WAVE: PCM, 1 канал, 16 кГц, 16 бит; размер данных по числу отсчётов", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]));
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(TARGET_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(wav.byteLength).toBe(44 + 8);
  });

  it("отсчёты: 0,5 → 16383, −0,5 → −16384, перегрузка обрезается до крайних значений", () => {
    const view = new DataView(encodeWav(new Float32Array([0.5, -0.5, 2, -2])).buffer);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      16384, -16384, 32767, -32768,
    ]);
  });

  it("тишина (пик < 1 %) и пустая запись — «тишина»; тихая речь — нет", () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
    expect(isSilent(new Float32Array(0))).toBe(true);
    expect(isSilent(new Float32Array([0, 0.02, -0.03]))).toBe(false);
  });
});

function env(duration: number, samples: Float32Array): AudioEnv {
  return {
    decode: async () => ({ duration }),
    resample: async () => samples,
  };
}

describe("VOICE-02: запись MediaRecorder → WAV для сервера", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])]);

  it("речь 3 с — WAV и длительность", async () => {
    const verdict = await recordingToWav(blob, env(3, new Float32Array([0.2, -0.2, 0.3])));
    expect(verdict).toMatchObject({ kind: "ok", seconds: 3 });
    const wav = verdict.kind === "ok" ? verdict.wav : new Uint8Array();
    expect(ascii(wav, 0, 4)).toBe("RIFF");
  });

  it("длиннее минуты — «слишком длинная», на пересчёт не идёт", async () => {
    let resampled = false;
    const verdict = await recordingToWav(blob, {
      decode: async () => ({ duration: 75 }),
      resample: async () => {
        resampled = true;
        return new Float32Array();
      },
    });
    expect(verdict).toEqual({ kind: "too-long" });
    expect(resampled).toBe(false);
  });

  it("запись из тишины — «тишина»: на сервер она не уходит и квоту не тратит", async () => {
    expect(await recordingToWav(blob, env(2, new Float32Array(32_000)))).toEqual({
      kind: "silent",
    });
  });
});

describe("VOICE-02: где работает микрофон", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "%s — доступен, если браузер умеет записывать",
    (hostname) => {
      expect(micMode({ hostname, hasRecorder: true })).toBe("available");
      expect(micMode({ hostname, hasRecorder: false })).toBe("unsupported");
    },
  );

  it.each(["192.168.1.15", "kosht.local", "evil.localhost.example"])(
    "%s — по сети: подсказка «Надиктуйте в Telegram»",
    (hostname) => {
      expect(micMode({ hostname, hasRecorder: true })).toBe("network");
    },
  );
});
