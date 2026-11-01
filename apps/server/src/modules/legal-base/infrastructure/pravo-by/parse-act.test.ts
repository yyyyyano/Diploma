// LAW-20, LAW-39 на настоящих страницах pravo.by из __fixtures__/pravo-by (сохранены 2026-10-30, офлайн): Закон № 90-З
// целиком, НК (Особенная часть) и ПСМ № 569 — обрезаны до нескольких статей и пунктов без изменения вёрстки. Страница с
// иной вёрсткой — копия настоящей (withChangedLayout).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withChangedLayout } from "../../__fixtures__/layout-changed.ts";
import { assessSnapshot, canaryOf } from "../../domain/quarantine.ts";
import { parseActPage } from "./parse-act.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

describe("разбор настоящих страниц pravo.by", () => {
  it("Закон № 90-З: 51 статья (48 и 9¹, 9², 38¹), заголовок, главы в пути, определения — свой вид", () => {
    const { title, parsed } = parseActPage(fixture("H10200090.html"), "Закон № 90-З");
    expect(title).toBe("О защите прав потребителей");
    expect(parsed.articleCount).toBe(51);
    const byKey = new Map(parsed.fragments.map((f) => [f.pathKey, f]));
    expect(byKey.get("a1")?.kind).toBe("definitions");
    expect(byKey.get("a1")?.searchPath).toBe("Закон № 90-З › Глава 1 › Статья 1");
    expect(byKey.get("a38.1")).toMatchObject({
      articleNo: "38.1",
      searchPath: "Закон № 90-З › Глава 4 › Статья 38¹",
    });
    expect(byKey.has("a9.1") && byKey.has("a9.2") && byKey.has("a48")).toBe(true);
    // Список изменяющих актов перед текстом — не нормы: во вступление он не попадает.
    expect(byKey.get("intro")?.body).not.toContain("Изменения и дополнения");
  });

  it("канарейка Закона № 90-З (51 статья, заголовок) проходит на настоящей странице", () => {
    const { title, parsed, pageText } = parseActPage(fixture("H10200090.html"), "Закон № 90-З");
    const canary = canaryOf("H10200090");
    expect(canary?.articleCount).toBe(51);
    expect(
      assessSnapshot({ title, parsed, pageText, ...(canary === undefined ? {} : { canary }) }),
    ).toEqual([]);
  });

  it("длинная статья режется по пунктам и подпунктам, длинный пункт — по абзацам; нет фрагментов длиннее предела", () => {
    const { parsed } = parseActPage(fixture("H10200090.html"), "Закон № 90-З");
    expect(parsed.fragments.filter((f) => f.pathKey.startsWith("a1/")).length).toBeGreaterThan(1);
    const nk = parseActPage(fixture("Hk0900071.html"), "НК (Особенная часть)").parsed;
    expect(nk.fragments.filter((f) => f.pathKey.startsWith("a210/p")).length).toBeGreaterThan(5);
    expect(nk.fragments.map((f) => f.pathKey)).toContain("a208/p4/c2");
    expect(nk.fragments.every((f) => f.body.length <= 3000)).toBe(true);
  });

  it("НК: исключённые статьи 113 и 140, надстрочные 159¹ и 216¹ с ключом через точку, путь «раздел › глава»", () => {
    const { parsed } = parseActPage(fixture("Hk0900071.html"), "НК (Особенная часть)");
    const byKey = new Map(parsed.fragments.map((f) => [f.pathKey, f]));
    expect(byKey.get("a113")).toMatchObject({ excluded: true, body: "Статья 113. Исключена." });
    expect(byKey.get("a140")?.excluded).toBe(true);
    expect(byKey.get("a210")?.excluded).toBe(false);
    const art216 = byKey.get("a216.1");
    expect(art216?.articleNo).toBe("216.1");
    expect(art216?.body.startsWith("Статья 216¹.")).toBe(true);
    expect(byKey.get("a208")?.searchPath).toBe(
      "НК (Особенная часть) › Особенная часть › Раздел V › Глава 18 › Статья 208",
    );
    // T-045: к семи статьям первой выборки добавлены 211, 214, 222, 223, 380 и 381² (страница, сохранённая 2026-11-01);
    // T-048: и 233, 244, 307⁸, 381⁷ — сроки налогов граждан (CAL-02).
    expect(parsed.articleCount).toBe(17);
    expect(byKey.get("a381.2")?.searchPath).toBe(
      "НК (Особенная часть) › Особенная часть › Раздел VII › Глава 40 › Статья 381²",
    );
  });

  it("НК: пункты с надстрочным номером (22², 28¹) — отдельные фрагменты, а не хвост соседнего", () => {
    const { parsed } = parseActPage(fixture("Hk0900071.html"), "НК (Особенная часть)");
    const byKey = new Map(parsed.fragments.map((f) => [f.pathKey, f]));
    expect(byKey.get("a208/p28")?.body).toBe("28. исключен;");
    expect(byKey.get("a208/p28.1")?.searchPath).toMatch(/ › п\. 28¹$/u);
    expect(byKey.get("a208/p22.2")?.body.startsWith("22². доходы")).toBe(true);
  });

  it("НК: приложение — отдельные фрагменты вида «приложение»", () => {
    const { parsed } = parseActPage(fixture("Hk0900071.html"), "НК (Особенная часть)");
    const appendix = parsed.fragments.filter((f) => f.kind === "appendix");
    expect(appendix.length).toBeGreaterThan(0);
    expect(appendix[0]).toMatchObject({
      pathKey: "app1/c1",
      searchPath: "НК (Особенная часть) › Приложение 2",
    });
  });

  it("ПСМ без статей: единица — пункт, вложенные 2.1, 2.2… — свои фрагменты, перечень изменений в шапке не попадает", () => {
    const { parsed } = parseActPage(fixture("C21300569.html"), "ПСМ № 569");
    const keys = parsed.fragments.map((f) => f.pathKey);
    expect(keys.slice(0, 5)).toEqual(["intro", "p1", "p2", "p2.1", "p2.2"]);
    expect(parsed.fragments.find((f) => f.pathKey === "p2.1")?.body).toBe("2.1. исключен;");
    expect(parsed.fragments[0]?.body).not.toContain("Изменения и дополнения");
  });

  it("копия страницы с иной вёрсткой не даёт структуры — карантин «нет структуры»", () => {
    const html = withChangedLayout(fixture("H10200090.html"));
    expect(html).toContain("Статья 1. Основные термины");
    const { title, parsed, pageText } = parseActPage(html, "Закон № 90-З");
    expect(parsed.hasStructure).toBe(false);
    expect(assessSnapshot({ title, parsed, pageText })).toContain("no-structure");
  });
});
