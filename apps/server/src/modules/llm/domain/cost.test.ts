import { describe, expect, it } from "vitest";
import { costMicros } from "./cost.ts";

describe("LLM-06: условная стоимость вызова", () => {
  it("токены × цена за миллион, вверх до целого микродоллара", () => {
    expect(
      costMicros(
        { input: 1000, output: 500 },
        { inputMicrosPerMillion: 590_000, outputMicrosPerMillion: 790_000 },
      ),
    ).toBe(985);
    expect(
      costMicros({ input: 1, output: 0 }, { inputMicrosPerMillion: 1, outputMicrosPerMillion: 0 }),
    ).toBe(1);
  });

  it("локальная и тестовая модели — ноль", () => {
    expect(
      costMicros(
        { input: 5000, output: 900 },
        { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 },
      ),
    ).toBe(0);
  });
});
