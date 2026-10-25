// make new-feature (ADR-0014): заготовка экрана — только для экранов из таблицы CAPABILITIES, без перезаписи.
// Генератор работает во временной копии нужных файлов, а не в репозитории.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  FEATURE_TEMPLATE,
  FEATURES_DIR,
  parseScreens,
  runNewFeature,
} from "./new-feature.ts";

const repo = fileURLToPath(new URL("../..", import.meta.url));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kosht-new-feature-"));
  for (const file of [CAPABILITIES, FEATURE_TEMPLATE]) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    cpSync(join(repo, file), join(root, file));
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("таблица «Экраны сайта» docs/CAPABILITIES.md", () => {
  it("читается вся: dashboard с двумя макетами, admin/<раздел> — фича admin", () => {
    const rows = parseScreens(readFileSync(join(repo, CAPABILITIES), "utf8"));
    expect(rows[0]).toEqual({ id: "dashboard", screens: ["Main", "MobileHome"], route: "`/`" });
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["operations", "setup", "admin"]));
    expect(rows.length).toBeGreaterThanOrEqual(19);
  });
});

describe("make new-feature", () => {
  it("создаёт паспорт с макетом и маршрутом из CAPABILITIES и index.ts", () => {
    const result = runNewFeature({ root, id: "operations" });
    expect(result.code).toBe(0);
    expect(result.files).toEqual([
      `${FEATURES_DIR}/operations/CLAUDE.md`,
      `${FEATURES_DIR}/operations/index.ts`,
    ]);
    const passport = readFileSync(join(root, FEATURES_DIR, "operations/CLAUDE.md"), "utf8");
    expect(passport).toMatch(/^# Экран `operations` — /);
    expect(passport).toContain("Маршрут: `/operations`");
    expect(passport).toContain("`design/screens/Operations.dc.html`");
    expect(passport).not.toContain("<!--");
  });

  it("экран не из таблицы — отказ с подсказкой, папка не создаётся", () => {
    const result = runNewFeature({ root, id: "wallet" });
    expect(result.code).toBe(1);
    expect(result.messages[0]).toMatch(/нет в таблице «Экраны сайта»/);
    expect(existsSync(join(root, FEATURES_DIR, "wallet"))).toBe(false);
  });

  it("готовую фичу не перезаписывает", () => {
    runNewFeature({ root, id: "accounts" });
    const again = runNewFeature({ root, id: "accounts" });
    expect(again).toMatchObject({ code: 1, files: [] });
  });
});
