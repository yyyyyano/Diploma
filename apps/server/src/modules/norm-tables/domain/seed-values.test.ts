// TAX-03: значения начального наполнения сверены с текстом нормы из сохранённой страницы НК (вычеты — 30.10.2026, ставки ст. 214 и 381² —
// 01.11.2026), а не с памятью. Числа, для которых в странице нет нормы, не выдаются за проверенные.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paramDef, RATE_PARAMS, valueInText } from "./params.ts";
import {
  CONSUMER_LAW_VERIFIED_ON,
  NK_VERIFIED_ON,
  SEED_RATES,
  SEED_VERIFIED_ON,
} from "./seed-values.ts";

const FIXTURES = {
  Hk0900071: new URL("../../legal-base/__fixtures__/pravo-by/Hk0900071.html", import.meta.url),
  H10200090: new URL("../../legal-base/__fixtures__/pravo-by/H10200090.html", import.meta.url),
} as const;

/** Текст страницы без разметки: абзацы по строкам, надстрочные цифры названий статей — знаками ¹ ² ³ … */
function plainText(fixture: URL): string {
  const supers = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
  return readFileSync(fixture, "utf8")
    .replace(/<sup>(\d)<\/sup>/giu, (_m, digit: string) => supers[Number(digit)] ?? "")
    .replace(/<br\s*\/?>|<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("\u00a0", " ")
    .replaceAll("&quot;", '"');
}

const texts = {
  Hk0900071: plainText(FIXTURES.Hk0900071),
  H10200090: plainText(FIXTURES.H10200090),
};
const text = texts.Hk0900071;

const articles = [...text.matchAll(/^Статья (\d+[⁰¹²³⁴⁵⁶⁷⁸⁹]?)\./gmu)].map((m) => m[1]);

/** Текст пункта («1.2», «3») статьи до следующего пункта того же уровня. */
function pointText(article: string, point: string, act: keyof typeof texts = "Hk0900071"): string {
  const source = texts[act];
  const start = source.indexOf(`Статья ${article}.`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nСтатья ", start + 1);
  const body = source.slice(start, next === -1 ? undefined : next);
  const parts = point.split(".");
  const last = Number(parts.at(-1));
  const prefix = parts.length > 1 ? `${parts.slice(0, -1).join(".")}.` : "";
  const from = body.indexOf(`\n${prefix}${String(last)}. `);
  const to = body.indexOf(`\n${prefix}${String(last + 1)}. `);
  expect(from).toBeGreaterThan(-1);
  return body.slice(from, to === -1 ? undefined : to);
}

describe("TAX-03: начальное наполнение", () => {
  it("каждое значение со статусом «подтверждено разработчиком» найдено в тексте нормы из фикстуры", () => {
    const checked = SEED_RATES.filter((rate) => rate.verified);
    expect(checked.map((r) => r.param)).toEqual([
      "ndfl.std-deduction.base",
      "ndfl.std-deduction.base-income-limit",
      "ndfl.std-deduction.child",
      "ndfl.std-deduction.child-increased",
      "ndfl.std-deduction.disabled",
      "ndfl.std-deduction.young-specialist",
      "ndfl.rate.base",
      "ndfl.rate.high",
      "ndfl.rate.high-from",
      "ndfl.rate.top",
      "ndfl.rate.top-from",
      "ip.rate.base",
      "ip.rate.high",
      "ip.rate.high-from",
      "npd.rate.base",
      "npd.rate.high",
      "npd.rate.high-from",
      "warranty.default-months",
      "deadline.property-tax",
      "deadline.land-tax",
      "deadline.transport-tax",
      "deadline.npd-payment",
      "deadline.declaration",
    ]);
    for (const rate of checked) {
      const unit = paramDef(rate.param)?.unit ?? "byn-minor";
      const act = rate.sourceAct === "H10200090" ? "H10200090" : "Hk0900071";
      const norm = pointText(rate.sourceArticle ?? "", rate.sourcePoint ?? "", act);
      expect([rate.param, valueInText(unit, rate.value, norm)]).toEqual([rate.param, true]);
    }
  });

  it("ставка НПД — в ст. 381², а не в ст. 380: в «Общих условиях» ставок нет", () => {
    expect(articles).toContain("380");
    expect(articles).toContain("381²");
    expect(pointText("380", "1")).not.toMatch(/процент/u);
    for (const rate of SEED_RATES.filter((r) => r.param.startsWith("npd."))) {
      expect(rate.sourceArticle).toBe("381²");
    }
  });

  it("срок гарантии — ст. 21 Закона № 90-З: фраза «в течение двух лет» в тексте пункта, 24 месяца, конца периода нет", () => {
    const warranty = SEED_RATES.find((r) => r.param === "warranty.default-months");
    expect(warranty).toMatchObject({
      value: 24,
      validTo: null,
      sourceAct: "H10200090",
      sourcePath: "a21/p1",
      verifiedOn: CONSUMER_LAW_VERIFIED_ON,
    });
    expect(pointText("21", "1", "H10200090")).toContain("в течение двух лет со дня передачи");
  });

  it("сроки налогов граждан (CAL-02): число и день сверены с пунктом НК, период без конца, день сверки — 01.11.2026", () => {
    const deadlines = SEED_RATES.filter((r) => r.param.startsWith("deadline."));
    expect(
      deadlines.map((r) => [r.param, r.value, r.sourceArticle, r.sourcePoint, r.sourcePath]),
    ).toEqual([
      ["deadline.property-tax", 1115, "233", "5", "a233/p5"],
      ["deadline.land-tax", 1115, "244", "8.1", "a244/p8.1"],
      ["deadline.transport-tax", 1115, "307⁸", "2", "a307.8/p2"],
      ["deadline.npd-payment", 22, "381⁷", "2", "a381.7"],
      ["deadline.declaration", 331, "222", "1", "a222"],
    ]);
    for (const rate of deadlines) {
      expect([rate.param, rate.validTo, rate.verifiedOn]).toEqual([
        rate.param,
        null,
        NK_VERIFIED_ON,
      ]);
      expect(paramDef(rate.param)?.group).toBe("deadline");
    }
    expect(articles).toEqual(expect.arrayContaining(["233", "244", "307⁸", "381⁷", "222"]));
    expect(pointText("233", "5")).toContain(
      "физическими лицами производится единым имущественным платежом",
    );
    expect(pointText("307⁸", "2")).toContain(
      "транспортного налога плательщиками – физическими лицами",
    );
    expect(pointText("381⁷", "2")).toContain(
      "не позднее 22-го числа месяца, следующего за истекшим налоговым периодом",
    );
  });

  it("значения без нормы в сохранённой странице (взнос ФСЗН, пределы ПДН) не выданы за проверенные и не ссылаются на страницу", () => {
    const waiting = SEED_RATES.filter((r) => !r.verified);
    expect(waiting.map((r) => r.param)).toEqual([
      "fszn.employee-rate",
      "pdn.limit.default",
      "pdn.limit.domestic-goods",
    ]);
    for (const rate of waiting) {
      expect([rate.param, rate.sourceAct, rate.verifiedOn]).toEqual([rate.param, null, null]);
    }
  });

  it("у каждого параметра реестра есть начальное значение на 2026 год; день сверки — день сохранения страницы: 30.10 у вычетов, 01.11 у ставок", () => {
    expect(SEED_RATES.map((r) => r.param).toSorted()).toEqual(
      RATE_PARAMS.map((p) => p.param).toSorted(),
    );
    expect(SEED_VERIFIED_ON).toBe("2026-10-30");
    expect(NK_VERIFIED_ON).toBe("2026-11-01");
    for (const rate of SEED_RATES.filter((r) => r.verified)) {
      expect(rate.verifiedOn).toBe(
        rate.param.startsWith("ndfl.std-deduction") || rate.sourceAct === "H10200090"
          ? SEED_VERIFIED_ON
          : NK_VERIFIED_ON,
      );
    }
    expect(text.length).toBeGreaterThan(10_000);
  });
});
