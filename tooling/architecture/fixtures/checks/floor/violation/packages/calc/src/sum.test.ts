import { describe, it } from "vitest";

describe("sum", () => {
  it.fails("складывает", () => {});
  it.todo("вычитает");
  it.skipIf(process.env.CI)("делит", () => {});
  describe.only("умножает", () => {});
});
