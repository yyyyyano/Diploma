// LAW-20, LAW-39 на сохранённых страницах __fixtures__/pravo-by (синтетических, офлайн): Закон № 90-З целиком — 51 статья,
// НК — длинная статья по пунктам, надстрочный номер, исключённая статья; указ — по пунктам; страница с иной вёрсткой
// не даёт структуры.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessSnapshot, canaryOf } from "../../domain/quarantine.ts";
import { parseActPage } from "./parse-act.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

describe("разбор сохранённых страниц pravo.by", () => {
  it("Закон № 90-З: 51 статья, заголовок и главы в пути, статья 20 исключена, определения — свой вид", () => {
    const { title, parsed } = parseActPage(fixture("H10200090.html"), "Закон № 90-З");
    expect(title).toContain("защите прав потребителей");
    expect(parsed.articleCount).toBe(51);
    const byKey = new Map(parsed.fragments.map((f) => [f.pathKey, f]));
    expect(byKey.get("a20")?.excluded).toBe(true);
    expect(byKey.get("a1")?.kind).toBe("definitions");
    expect(byKey.get("a6")?.searchPath).toBe("Закон № 90-З › Глава 1 › Статья 6");
    expect(byKey.get("a51")?.kind).toBe("effective-date");
  });

  it("канарейка Закона № 90-З проходит на сохранённой странице", () => {
    const { title, parsed, pageText } = parseActPage(fixture("H10200090.html"), "Закон № 90-З");
    const canary = canaryOf("H10200090");
    expect(canary).toBeDefined();
    expect(
      assessSnapshot({ title, parsed, pageText, ...(canary === undefined ? {} : { canary }) }),
    ).toEqual([]);
  });

  it("НК: длинная статья 210 — по пунктам, статья 216¹ — ключ 216.1, статья 217 исключена", () => {
    const { parsed } = parseActPage(fixture("Hk0900071.html"), "НК (Особенная часть)");
    const keys = parsed.fragments.map((f) => f.pathKey);
    expect(keys).toEqual([
      "a209",
      "a210",
      "a210/p1",
      "a210/p2",
      "a210/p3",
      "a210/p4",
      "a216.1",
      "a217",
    ]);
    const art216 = parsed.fragments.find((f) => f.pathKey === "a216.1");
    expect(art216?.articleNo).toBe("216.1");
    expect(art216?.body.startsWith("Статья 216¹. Особенности исчисления")).toBe(true);
    expect(parsed.fragments.find((f) => f.pathKey === "a217")?.excluded).toBe(true);
    expect(parsed.fragments[0]?.searchPath).toBe(
      "НК (Особенная часть) › Особенная часть › Раздел V › Глава 16 › Статья 209",
    );
  });

  it("ПСМ без статей: единица — пункт, подпункты остаются в пункте", () => {
    const { parsed } = parseActPage(fixture("C21300569.html"), "ПСМ № 569");
    expect(parsed.fragments.map((f) => f.pathKey)).toEqual(["intro", "p1", "p1.1", "p2", "p3"]);
    expect(parsed.fragments.find((f) => f.pathKey === "p2")?.body).toContain("2) свидетельство");
  });

  it("страница с иной вёрсткой не даёт структуры — карантин по причине «нет структуры»", () => {
    const { title, parsed, pageText } = parseActPage(
      fixture("H10200090.layout-changed.html"),
      "Закон № 90-З",
    );
    expect(parsed.hasStructure).toBe(false);
    expect(assessSnapshot({ title, parsed, pageText })).toContain("no-structure");
  });
});
