// TAX-03: значения начального наполнения сверены с текстом нормы из сохранённой страницы НК (вычеты — 30.10.2026, ставки ст. 214 и 381² —
// 01.11.2026), а не с памятью. Числа, для которых в странице нет нормы, не выдаются за проверенные.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { numberText, paramDef, RATE_PARAMS, textHasNumber } from "./params.ts";
import { NK_VERIFIED_ON, SEED_RATES, SEED_VERIFIED_ON } from "./seed-values.ts";

const FIXTURE = new URL("../../legal-base/__fixtures__/pravo-by/Hk0900071.html", import.meta.url);

/** Текст страницы без разметки: абзацы по строкам, надстрочные цифры названий статей — знаками ¹ ² ³. */
const text = readFileSync(FIXTURE, "utf8")
  .replace(/<sup>(\d)<\/sup>/giu, (_m, digit: string) => ["", "¹", "²", "³"][Number(digit)] ?? "")
  .replace(/<br\s*\/?>|<\/p>/giu, "\n")
  .replace(/<[^>]+>/gu, "")
  .replaceAll("&nbsp;", " ")
  .replaceAll("\u00a0", " ")
  .replaceAll("&quot;", '"');

const articles = [...text.matchAll(/^Статья (\d+[¹²³]?)\./gmu)].map((m) => m[1]);

/** Текст пункта («1.2», «3») статьи до следующего пункта того же уровня. */
function pointText(article: string, point: string): string {
  const start = text.indexOf(`Статья ${article}.`);
  const next = text.indexOf("\nСтатья ", start + 1);
  const body = text.slice(start, next === -1 ? undefined : next);
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
    ]);
    for (const rate of checked) {
      const unit = paramDef(rate.param)?.unit ?? "byn-minor";
      const norm = pointText(rate.sourceArticle ?? "", rate.sourcePoint ?? "");
      expect([rate.param, textHasNumber(norm, numberText(unit, rate.value))]).toEqual([
        rate.param,
        true,
      ]);
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
        rate.param.startsWith("ndfl.std-deduction") ? SEED_VERIFIED_ON : NK_VERIFIED_ON,
      );
    }
    expect(text.length).toBeGreaterThan(10_000);
  });
});
