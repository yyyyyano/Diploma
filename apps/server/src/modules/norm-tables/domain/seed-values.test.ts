// TAX-03: значения начального наполнения сверены с текстом нормы из сохранённой страницы НК (30.10.2026), а не с памятью. Числа,
// для которых в странице нет статьи, не выдаются за проверенные.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { numberText, paramDef, RATE_PARAMS, textHasNumber } from "./params.ts";
import { SEED_RATES, SEED_VERIFIED_ON } from "./seed-values.ts";

const FIXTURE = new URL("../../legal-base/__fixtures__/pravo-by/Hk0900071.html", import.meta.url);

/** Текст страницы без разметки: абзацы по строкам. */
const text = readFileSync(FIXTURE, "utf8")
  .replace(/<br\s*\/?>|<\/p>/giu, "\n")
  .replace(/<[^>]+>/gu, "")
  .replaceAll("&nbsp;", " ")
  .replaceAll("\u00a0", " ")
  .replaceAll("&quot;", '"');

const articles = [...text.matchAll(/^Статья (\d+)(?:¹|\.)/gmu)].map((m) => m[1]);

/** Текст подпункта «1.2.» статьи до следующего подпункта первого уровня. */
function pointText(article: string, point: string): string {
  const start = text.indexOf(`Статья ${article}.`);
  const next = text.indexOf("\nСтатья ", start + 1);
  const body = text.slice(start, next === -1 ? undefined : next);
  const [major, minor] = point.split(".").map(Number);
  const from = body.indexOf(`\n${String(major)}.${String(minor)}. `);
  const to = body.indexOf(`\n${String(major)}.${String((minor ?? 0) + 1)}. `);
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

  it("значения без статьи в сохранённой странице не выданы за проверенные: статей 214 и 380 в ней нет", () => {
    expect(articles).not.toContain("214");
    expect(articles).not.toContain("380");
    for (const rate of SEED_RATES.filter((r) => !r.verified)) {
      expect(rate.sourceAct === null || rate.sourceArticle !== "209").toBe(true);
    }
  });

  it("у каждого параметра реестра есть начальное значение на 2026 год, дата сверки — день сохранения страницы", () => {
    expect(SEED_RATES.map((r) => r.param).toSorted()).toEqual(
      RATE_PARAMS.map((p) => p.param).toSorted(),
    );
    expect(SEED_VERIFIED_ON).toBe("2026-10-30");
    expect(text.length).toBeGreaterThan(10_000);
  });
});
