// Словарь правового консультанта (LEGAL-03…08): ключи есть, подстановка и русские множественные числа работают, словарь не
// попал в общие `resources` (бюджет первой загрузки сайта).
import { describe, expect, it } from "vitest";
import { createLegalT } from "./create-legal-t.ts";
import { NAMESPACES, resources } from "./resources.ts";

const t = createLegalT();

describe("LEGAL-07, LEGAL-05: тексты под правовым ответом", () => {
  it("пометка «Не является юридической консультацией» и дата редакции подставляется параметром", () => {
    expect(t("disclaimer")).toBe("Не является юридической консультацией.");
    expect(t("quote.edition", { date: "21.10.2026" })).toBe("в редакции на 21.10.2026");
  });

  it("число непроверенных ссылок — по-русски: 1, 2, 5", () => {
    expect(t("unresolved", { count: 1 })).toContain("Одну ссылку");
    expect(t("unresolved", { count: 2 })).toContain("2 ссылки");
    expect(t("unresolved", { count: 5 })).toContain("5 ссылок");
  });

  it("словарь не входит в общие пространства имён сайта", () => {
    expect(NAMESPACES).not.toContain("legal");
    expect(Object.keys(resources.ru)).not.toContain("legal");
  });
});
