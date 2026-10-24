// DES-01, ADR-0014: цвета, отступы и радиусы сайта — только токенами темы; «сырые» значения допустимы лишь
// в apps/web/src/ui/theme. no-raw-colors.mjs на фикстурах с настоящей раскладкой apps/web/src.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runNoRawColors } from "./no-raw-colors.mjs";

const fixtures = fileURLToPath(
  new URL("../architecture/fixtures/checks/no-raw-colors/", import.meta.url),
);
const ops = "apps/web/src/features/operations";

function found(baseDir: string): string[] {
  return runNoRawColors({ baseDir }).findings.map(
    (f) => `${f.file}:${f.line} ${f.rule} ${/«([^»]+)»/.exec(f.message)?.[1]}`,
  );
}

describe("no-raw-colors: «сырые» значения вне ui/theme", () => {
  const violations = found(join(fixtures, "violation"));

  it("в TSX: #hex, rgb(, hsl( в строках и шаблонах; числа в style и в отступах Mantine", () => {
    expect(violations.filter((v) => v.includes("OperationRow.tsx"))).toEqual([
      `${ops}/OperationRow.tsx:3 raw-color #11564D`,
      `${ops}/OperationRow.tsx:3 magic-spacing padding: 13`,
      `${ops}/OperationRow.tsx:3 magic-spacing borderRadius: 6`,
      `${ops}/OperationRow.tsx:3 magic-spacing p=13`,
      `${ops}/OperationRow.tsx:3 magic-spacing gap=12`,
      `${ops}/OperationRow.tsx:4 raw-color rgb(`,
      `${ops}/OperationRow.tsx:5 raw-color hsl(`,
      `${ops}/OperationRow.tsx:5 magic-spacing radius=4`,
      `${ops}/OperationRow.tsx:6 raw-color #fff8`,
      `${ops}/OperationRow.tsx:6 magic-spacing marginTop: -8`,
    ]);
  });

  it("в CSS: цвета в значениях свойств и числовые отступы и радиусы; #id в селекторе — не цвет", () => {
    expect(violations.filter((v) => v.includes(".css"))).toEqual([
      `${ops}/operations.module.css:2 raw-color #11564d`,
      `${ops}/operations.module.css:3 magic-spacing padding: 12`,
      `${ops}/operations.module.css:4 magic-spacing border-top-left-radius: 6`,
      `${ops}/operations.module.css:5 raw-color rgba(`,
    ]);
  });

  it("в обычном .ts вне темы — тоже нарушение; код 1 и сообщение с подсказкой токена", () => {
    const result = runNoRawColors({ baseDir: join(fixtures, "violation") });
    expect(result.code).toBe(1);
    expect(result.messages).toContain(
      "apps/web/src/entities/chart/series.ts:1 — сырой цвет «#c2700e» вне ui/theme (DES-01): возьмите " +
        "токен из ui/theme/tokens.css (var(--brand) и т. п.) или таблицу ui/theme/category-colors.ts, chart-colors.ts.",
    );
  });
});

describe("no-raw-colors: законный код не ловится", () => {
  it("токены, 0, якоря #main и #bad-anchor, комментарии, тесты и сама ui/theme — чисто", () => {
    const result = runNoRawColors({ baseDir: join(fixtures, "clean") });
    expect({ code: result.code, files: result.files, findings: result.findings }).toEqual({
      code: 0,
      files: 2,
      findings: [],
    });
  });

  it("сайта ещё нет — код 0 и 0 файлов", () => {
    const empty = mkdtempSync(join(tmpdir(), "no-raw-colors-"));
    try {
      expect(runNoRawColors({ baseDir: empty })).toMatchObject({ code: 0, files: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
