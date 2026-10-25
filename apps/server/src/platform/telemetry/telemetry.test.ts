import { describe, expect, it } from "vitest";
import { createTelemetry } from "./telemetry.ts";

describe("OBS-03: опции трасс вызова модели", () => {
  it("по умолчанию выключено, но functionId, userId и sessionId уже в опциях вызова", () => {
    expect(
      createTelemetry(false).options({ functionId: "chat", userId: "u-1", sessionId: "c-1" }),
    ).toEqual({
      telemetry: {
        isEnabled: false,
        functionId: "chat",
        includeRuntimeContext: { userId: true, sessionId: true },
      },
      runtimeContext: { userId: "u-1", sessionId: "c-1" },
    });
  });

  it("задача без пользователя (systemCaller) — без userId и sessionId", () => {
    expect(createTelemetry(true).options({ functionId: "law.topic" }).runtimeContext).toEqual({});
  });
});
