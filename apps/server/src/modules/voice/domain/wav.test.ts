// VOICE-02, SEC-03: запись проверяется по заголовку WAV — 16 кГц, PCM 16 бит, ≤ 60 с; остальное отсекается до модели.
import { makeWav } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { judgeRecording } from "./wav.ts";

describe("VOICE-02: проверка записи по заголовку", () => {
  it("5 секунд моно 16 кГц — подходит, длительность считается по данным", () => {
    expect(judgeRecording(makeWav({ seconds: 5 }))).toEqual({ ok: true, seconds: 5 });
  });

  it("стерео 16 кГц подходит", () => {
    expect(judgeRecording(makeWav({ seconds: 2, channels: 2 }))).toEqual({ ok: true, seconds: 2 });
  });

  it("ровно 60 секунд подходит, 62 — «слишком длинная»", () => {
    expect(judgeRecording(makeWav({ seconds: 60 })).ok).toBe(true);
    expect(judgeRecording(makeWav({ seconds: 62 }))).toEqual({ ok: false, reason: "size" });
  });

  it("другая частота (44,1 кГц) не подходит: whisper-server её не пересчитывает", () => {
    expect(judgeRecording(makeWav({ sampleRate: 44_100 }))).toEqual({ ok: false, reason: "type" });
  });

  it("8 бит и не-PCM не подходят", () => {
    expect(judgeRecording(makeWav({ bits: 8 }))).toEqual({ ok: false, reason: "type" });
    expect(judgeRecording(makeWav({ format: 3 }))).toEqual({ ok: false, reason: "type" });
  });

  it("не WAV (MP3, текст, пусто) — «не тот тип», даже если назвали audio.wav", () => {
    expect(judgeRecording(new TextEncoder().encode("ID3\u0004hello world, not a wav")).ok).toBe(
      false,
    );
    expect(judgeRecording(new Uint8Array())).toEqual({ ok: false, reason: "type" });
  });

  it("больше 4 МБ — «слишком большая» без разбора заголовка", () => {
    expect(judgeRecording(new Uint8Array(4_000_001))).toEqual({ ok: false, reason: "size" });
  });

  it("заголовок врёт про размер данных — верим фактическому остатку", () => {
    const wav = makeWav({ seconds: 1 });
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true);
    expect(judgeRecording(wav)).toEqual({ ok: true, seconds: 1 });
  });
});
