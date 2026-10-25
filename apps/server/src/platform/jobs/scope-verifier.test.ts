import { testHouseholdId, testUserId } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { createScopeVerifierRegistry } from "./scope-verifier.ts";

const candidate = { userId: testUserId(1), householdId: testHouseholdId(1) };

describe("SEC-04: реестр проверки scope задач", () => {
  it("проверка не зарегистрирована — владелец не проходит", async () => {
    expect(await createScopeVerifierRegistry().verify(candidate)).toBe(false);
  });

  it("зарегистрированная проверка решает, проходит ли владелец", async () => {
    const registry = createScopeVerifierRegistry();
    registry.register(async (c) => c.householdId === testHouseholdId(1));
    expect(await registry.verify(candidate)).toBe(true);
    expect(await registry.verify({ ...candidate, householdId: testHouseholdId(2) })).toBe(false);
  });

  it("вторая регистрация — ошибка при старте: источник проверки один", () => {
    const registry = createScopeVerifierRegistry();
    registry.register(async () => true);
    expect(() => registry.register(async () => true)).toThrow("уже зарегистрирована");
  });
});
