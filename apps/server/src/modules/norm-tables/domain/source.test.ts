import { describe, expect, it } from "vitest";
import { normalizeNumber, pathKeyOf } from "./source.ts";

describe("TAX-03: ключ фрагмента источника", () => {
  it("статья и пункт → ключ фрагмента; надстрочный номер — через точку", () => {
    expect(pathKeyOf("209", "1.2")).toBe("a209/p1.2");
    expect(pathKeyOf("209", null)).toBe("a209");
    expect(pathKeyOf("216¹", "3")).toBe("a216.1/p3");
    expect(normalizeNumber("216.1")).toBe("216.1");
  });

  it("надстрочные цифры 0–9: ст. 307⁸ и 381⁷ (сроки транспортного налога и НПД) — ключи a307.8 и a381.7", () => {
    expect(pathKeyOf("307⁸", "2")).toBe("a307.8/p2");
    expect(pathKeyOf("381⁷", null)).toBe("a381.7");
    expect(normalizeNumber("12⁰")).toBe("12.0");
  });

  it("не номер или нет статьи — нет ключа: сверка с редакцией для такой строки не ведётся", () => {
    expect(pathKeyOf(null, "1.2")).toBeNull();
    expect(pathKeyOf("ПДН", null)).toBeNull();
    expect(pathKeyOf("209", "первый")).toBeNull();
  });
});
