// VOICE-03: порт Transcriber передаёт запись шлюзу вместе с вызывающим (согласие и журнал считает шлюз).
import { describe, expect, it } from "vitest";
import { systemCaller } from "../domain/caller.ts";
import { gatewayTranscriber } from "./transcriber.ts";

describe("VOICE-03: Transcriber поверх шлюза", () => {
  it("запись и вызывающий уходят шлюзу, текст возвращается как есть", async () => {
    const calls: unknown[] = [];
    const transcriber = gatewayTranscriber(
      {
        transcribe: async (caller, audio) => {
          calls.push([caller, audio]);
          return "потратил пятнадцать рублей";
        },
      },
      systemCaller("voice"),
    );
    const audio = new Uint8Array([1, 2, 3]);
    expect(await transcriber.transcribe(audio)).toBe("потратил пятнадцать рублей");
    expect(calls).toEqual([[systemCaller("voice"), audio]]);
  });
});
