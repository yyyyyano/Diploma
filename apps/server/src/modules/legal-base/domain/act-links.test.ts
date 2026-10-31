import { describe, expect, it } from "vitest";
import { parseActLinks, pravoIdOfLine } from "./act-links.ts";

describe("LAW-16: ID актов из ссылок администратора", () => {
  it("ссылка pravo.by на текст и на карточку, а также сам ID дают один ID", () => {
    expect(pravoIdOfLine("https://pravo.by/document/?guid=3871&p0=H10200090")).toBe("H10200090");
    expect(pravoIdOfLine("https://pravo.by/document/?guid=3961&p0=Hk0900071&p1=1")).toBe(
      "Hk0900071",
    );
    expect(pravoIdOfLine(" H10200090 ")).toBe("H10200090");
  });

  it("чужой сайт, ссылка без p0 и мусор — не ID (LAW-03: тексты только с pravo.by)", () => {
    expect(pravoIdOfLine("https://example.com/document/?p0=H10200090")).toBeNull();
    expect(pravoIdOfLine("https://pravo.by/document/?guid=3871")).toBeNull();
    expect(pravoIdOfLine("javascript:alert(1)")).toBeNull();
    expect(pravoIdOfLine("не ссылка")).toBeNull();
    expect(pravoIdOfLine("https://pravo.by/document/?p0=bad id")).toBeNull();
  });

  it("список: повторы схлопываются, пустые строки пропускаются, нераспознанные возвращаются", () => {
    expect(
      parseActLinks([
        "https://pravo.by/document/?guid=3871&p0=H10200090",
        "",
        "H10200090",
        "ерунда",
        "Hk0900071",
      ]),
    ).toEqual({ ids: ["H10200090", "Hk0900071"], rejected: ["ерунда"] });
  });
});
