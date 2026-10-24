// CONSTRAINTS «Бюджеты производительности»: JS сайта при первой загрузке ≤ 300 КБ gzip, чанк маршрута ≤ 150 КБ,
// чат с Markdown ≤ 200 КБ. bundle-size.mjs на фикстуре сборки Vite (web-build/): первая загрузка — скрипты и
// modulepreload из index.html; бюджеты подставляются маленькими, чтобы не хранить в git сотни килобайт.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { BUDGETS, runBundleSize } from "./bundle-size.mjs";

const build = fileURLToPath(
  new URL("../architecture/fixtures/checks/bundle-size/web-build/", import.meta.url),
);
const gz = (file: string) => gzipSync(readFileSync(join(build, file))).length;

describe("bundle-size: бюджеты CONSTRAINTS", () => {
  it("бюджеты — из CONSTRAINTS: 300 КБ, 150 КБ, чат 200 КБ (1 КБ = 1000 байт, как в отчёте Vite)", () => {
    expect(BUDGETS).toEqual({ firstLoad: 300_000, routeChunk: 150_000, chatChunk: 200_000 });
  });

  it("первая загрузка — сумма gzip скрипта и modulepreload из index.html; в бюджете — код 0", () => {
    const result = runBundleSize({ distDir: build });
    expect(result.code).toBe(0);
    expect(result.firstLoad).toBe(gz("assets/index-a1b2.js") + gz("assets/vendor-c3d4.js"));
    expect(result.files).toBe(4);
  });

  it("первая загрузка и чанки сверх бюджета — код 1, каждое превышение названо с размером", () => {
    const result = runBundleSize({
      distDir: build,
      budgets: { firstLoad: 10, routeChunk: 10, chatChunk: 10 },
    });
    expect(result.code).toBe(1);
    expect(result.findings.map((f) => `${f.file} ${f.rule}`)).toEqual([
      "index.html first-load",
      "assets/assistant-2c3d.js chat-chunk",
      "assets/operations-0a1b.js route-chunk",
    ]);
    expect(result.messages[0]).toContain("первая загрузка");
    expect(result.messages[0]).toContain("больше бюджета 0,01 КБ gzip");
  });

  it("чанк чата меряется своим бюджетом: маршрут сверх 150, чат в пределах 200 — ловится только маршрут", () => {
    const result = runBundleSize({
      distDir: build,
      budgets: { firstLoad: 1_000_000, routeChunk: 1, chatChunk: 1_000_000 },
    });
    expect(result.findings.map((f) => f.file)).toEqual(["assets/operations-0a1b.js"]);
  });
});

describe("bundle-size: не смог проверить — код 2", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function dist(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "bundle-size-"));
    dirs.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  it("сборки нет — код 2 с подсказкой собрать сайт", () => {
    const result = runBundleSize({ distDir: dist({}) });
    expect(result.code).toBe(2);
    expect(result.messages[0]).toContain("index.html");
  });

  it("в index.html нет ни одного скрипта — код 2, а не «0 КБ, всё в бюджете»", () => {
    expect(runBundleSize({ distDir: dist({ "index.html": "<html></html>" }) }).code).toBe(2);
  });

  it("index.html ссылается на несуществующий файл — код 2", () => {
    const html = '<script type="module" src="/assets/gone.js"></script>';
    expect(runBundleSize({ distDir: dist({ "index.html": html }) }).code).toBe(2);
  });
});
