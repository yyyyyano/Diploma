import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { isSystemCaller, systemCaller } from "./caller.ts";

describe("PRIV-09: вызов без данных пользователя", () => {
  it("systemCaller модуля отличим от scope пользователя", () => {
    expect(isSystemCaller(systemCaller("legal-base"))).toBe(true);
    expect(isSystemCaller(testScope())).toBe(false);
  });

  it("не id модуля — ошибка", () => {
    expect(() => systemCaller("Legal Base")).toThrow(RangeError);
  });
});
