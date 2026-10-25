// make deps-check (ADR-0002, ARCHITECTURE §15): dependency-cruiser с TS 7 может молча проверить 0 файлов —
// страховка: меньше порога файлов → код 2, неразрешённый импорт → код 1, нарушение правила → код 1.
// Проверка идёт с настоящим .dependency-cruiser.mjs на фикстурах fixtures/deps-guard/ и на самом репозитории.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_MODULES, runDepsGuard } from "./deps-guard.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = join(repoRoot, "tooling/architecture/fixtures/deps-guard");
const script = fileURLToPath(new URL("./deps-guard.mjs", import.meta.url));

describe("deps-guard: порог числа проверенных файлов", () => {
  it("проверено меньше порога — код 2 и сообщение про «0 модулей», даже без нарушений", async () => {
    const result = await runDepsGuard({ baseDir: join(fixtures, "few-files"), minModules: 2 });
    expect(result.code).toBe(2);
    expect(result.files).toBe(1);
    expect(result.messages.join("\n")).toContain("меньше порога 2");
  });

  it("нет ни одного корня обхода — код 2, а не «нарушений не найдено»", async () => {
    const empty = mkdtempSync(join(tmpdir(), "deps-guard-"));
    try {
      const result = await runDepsGuard({ baseDir: empty, minModules: 1 });
      expect({ code: result.code, files: result.files }).toEqual({ code: 2, files: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("порог набран, нарушений нет — код 0; несуществующие корни (apps, packages, e2e) не мешают", async () => {
    const result = await runDepsGuard({ baseDir: join(fixtures, "few-files"), minModules: 1 });
    expect(result.code).toBe(0);
  });
});

describe("deps-guard: неразрешённые импорты и нарушения правил", () => {
  it("неразрешённый импорт — код 1 с указанием, откуда и что не найдено", async () => {
    const result = await runDepsGuard({ baseDir: join(fixtures, "unresolvable"), minModules: 1 });
    expect(result.code).toBe(1);
    expect(result.messages.join("\n")).toContain("tooling/a.ts → ./missing.ts");
  });

  it("импорт чужого модуля мимо index.ts — код 1 и имя правила module-public-api-only", async () => {
    const result = await runDepsGuard({ baseDir: join(fixtures, "past-index"), minModules: 1 });
    expect(result.code).toBe(1);
    expect(result.messages.join("\n")).toContain("module-public-api-only");
  });
});

describe("deps-guard: все модули карты в графе (T-007)", () => {
  it("в графе нет index.ts модуля из карты — код 2 с именем модуля, даже без нарушений", async () => {
    const result = await runDepsGuard({
      baseDir: join(fixtures, "missing-module"),
      minModules: 1,
      requiredModules: ["accounts", "identity"],
    });
    expect(result.code).toBe(2);
    expect(result.messages.join("\n")).toContain("apps/server/src/modules/identity/index.ts");
    expect(result.messages.join("\n")).not.toContain("modules/accounts/");
  });

  it("index.ts всех требуемых модулей в графе — код 0", async () => {
    const result = await runDepsGuard({
      baseDir: join(fixtures, "missing-module"),
      minModules: 1,
      requiredModules: ["accounts"],
    });
    expect(result.code).toBe(0);
  });
});

describe("deps-guard на репозитории", () => {
  it("make deps-check на текущем дереве зелёный и проверяет не меньше MIN_MODULES файлов", () => {
    const run = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: "utf8" });
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: "" });
    const files = Number(/проверено файлов: (\d+)/.exec(run.stdout)?.[1]);
    expect(files).toBeGreaterThanOrEqual(MIN_MODULES);
  });
});
