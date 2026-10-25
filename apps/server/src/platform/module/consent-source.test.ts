import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { createConsentRegistry } from "./consent-source.ts";

describe("PRIV-02: облачное согласие", () => {
  it("источника нет — облако запрещено", async () => {
    expect(await createConsentRegistry().cloudAllowed(testScope())).toBe(false);
  });

  it("источник решает за пользователя; второй источник — ошибка при старте", async () => {
    const registry = createConsentRegistry();
    registry.register(async (scope) => scope.userId === testScope({ user: 1 }).userId);
    expect(await registry.cloudAllowed(testScope({ user: 1 }))).toBe(true);
    expect(await registry.cloudAllowed(testScope({ user: 2, household: 2 }))).toBe(false);
    expect(() => registry.register(async () => true)).toThrow(/уже зарегистрирован/);
  });
});
