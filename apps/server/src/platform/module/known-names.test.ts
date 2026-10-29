import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { createKnownNamesRegistry } from "./known-names.ts";

describe("PRIV-03: словарь имён пользователя", () => {
  it("источника нет — словарь пуст", async () => {
    expect(await createKnownNamesRegistry().names(testScope())).toEqual([]);
  });

  it("источник отвечает за пользователя; второй источник — ошибка при старте", async () => {
    const registry = createKnownNamesRegistry();
    registry.register(async (scope) =>
      scope.userId === testScope({ user: 1 }).userId ? ["Анна"] : [],
    );
    expect(await registry.names(testScope({ user: 1 }))).toEqual(["Анна"]);
    expect(await registry.names(testScope({ user: 2, household: 2 }))).toEqual([]);
    expect(() => registry.register(async () => [])).toThrow(/уже зарегистрирован/);
  });
});
