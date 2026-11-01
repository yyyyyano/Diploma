// VOICE-02, VOICE-03: запись → текст в поле. Микрофон, запись и сервер — подмены (звука в тестах нет).
import { ORPCError } from "@orpc/client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useVoiceInput, type VoiceDeps } from "./use-voice-input.ts";
import type { AudioEnv } from "./wav-encoder.ts";

class FakeRecorder {
  static last: FakeRecorder | undefined;
  readonly stream = { getTracks: () => [{ stop: vi.fn<() => void>() }] } as unknown as MediaStream;
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(stream: MediaStream) {
    void stream;
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    this.onstop?.();
  }
}

const speech: AudioEnv = {
  decode: async () => ({ duration: 2 }),
  resample: async () => new Float32Array([0.2, -0.2]),
};

function deps(over: Partial<VoiceDeps> = {}): VoiceDeps {
  return {
    hostname: "localhost",
    mediaDevices: { getUserMedia: async () => ({}) as MediaStream },
    recorder: FakeRecorder as unknown as typeof MediaRecorder,
    audio: () => speech,
    transcribe: async () => "потратил пятнадцать рублей на кофе",
    maxSeconds: 60,
    ...over,
  };
}

async function record(result: { current: ReturnType<typeof useVoiceInput> }) {
  act(() => result.current.start());
  await waitFor(() => expect(result.current.status).toBe("recording"));
  act(() => result.current.stop());
}

describe("VOICE-02: запись → текст в поле", () => {
  it("запись и «стоп»: текст распознавания уходит в поле, статус возвращается в «ждёт»", async () => {
    const onText = vi.fn<(text: string) => void>();
    const { result } = renderHook(() => useVoiceInput({ onText, deps: deps() }));
    expect(result.current.mode).toBe("available");
    await record(result);
    await waitFor(() => expect(onText).toHaveBeenCalledWith("потратил пятнадцать рублей на кофе"));
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
  });

  it("по сети (не localhost) режим «network», кнопки нет", () => {
    const { result } = renderHook(() =>
      useVoiceInput({
        onText: vi.fn<(text: string) => void>(),
        deps: deps({ hostname: "192.168.1.15" }),
      }),
    );
    expect(result.current.mode).toBe("network");
  });

  it("микрофон запрещён пользователем — «denied»", async () => {
    const { result } = renderHook(() =>
      useVoiceInput({
        onText: vi.fn<(text: string) => void>(),
        deps: deps({
          mediaDevices: {
            getUserMedia: async () => {
              throw new DOMException("denied", "NotAllowedError");
            },
          },
        }),
      }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe("denied"));
    expect(result.current.status).toBe("idle");
  });

  it("тишина — «empty», на сервер запись не уходит", async () => {
    const transcribe = vi.fn<(wav: Uint8Array) => Promise<string>>(
      async () => "не должно вызываться",
    );
    const { result } = renderHook(() =>
      useVoiceInput({
        onText: vi.fn<(text: string) => void>(),
        deps: deps({
          transcribe,
          audio: () => ({
            decode: async () => ({ duration: 2 }),
            resample: async () => new Float32Array(100),
          }),
        }),
      }),
    );
    await record(result);
    await waitFor(() => expect(result.current.error).toBe("empty"));
    expect(transcribe).not.toHaveBeenCalled();
  });

  it.each([
    ["FILE_TOO_LARGE", "tooLong"],
    ["UNAVAILABLE", "unavailable"],
    ["INTERNAL", "failed"],
  ] as const)("ошибка сервера %s — текст «%s»", async (code, key) => {
    const { result } = renderHook(() =>
      useVoiceInput({
        onText: vi.fn<(text: string) => void>(),
        deps: deps({
          transcribe: async () => {
            throw new ORPCError(code);
          },
        }),
      }),
    );
    await record(result);
    await waitFor(() => expect(result.current.error).toBe(key));
  });

  it("слишком частые записи — «rateLimited» с минутами из ответа", async () => {
    const { result } = renderHook(() =>
      useVoiceInput({
        onText: vi.fn<(text: string) => void>(),
        deps: deps({
          transcribe: async () => {
            throw new ORPCError("RATE_LIMITED", {
              data: { requestId: "r", params: { retryAfterMinutes: 3 } },
            });
          },
        }),
      }),
    );
    await record(result);
    await waitFor(() => expect(result.current.error).toBe("rateLimited"));
    expect(result.current.retryAfterMinutes).toBe(3);
  });

  it("запись останавливается сама через предел (60 с)", async () => {
    vi.useFakeTimers();
    try {
      const onText = vi.fn<(text: string) => void>();
      const { result } = renderHook(() => useVoiceInput({ onText, deps: deps({ maxSeconds: 1 }) }));
      act(() => result.current.start());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.status).toBe("recording");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(FakeRecorder.last?.state).toBe("inactive");
    } finally {
      vi.useRealTimers();
    }
  });
});
