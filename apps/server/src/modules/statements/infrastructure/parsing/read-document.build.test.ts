// T-025: чтение выписок работает и из собранного образа. Рабочий файл собирается по настоящей точке входа
// `statement-parse.worker` из tsdown.config.ts, а вызывающий бандл находит `statement-parse.worker.mjs` рядом с собой;
// библиотеки разбора (unpdf, SheetJS, papaparse, sharp) — внешние, из node_modules приложения, как в образе.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, type InlineConfig } from "tsdown";
import { afterAll, describe, expect, it } from "vitest";
import { ENTRIES } from "../../../../../tsdown.config.ts";

const run = promisify(execFile);
const serverDir = fileURLToPath(new URL("../../../../../", import.meta.url));
const dataset = fileURLToPath(
  new URL("../../../../../../../datasets/statements/", import.meta.url),
);
const caller = fileURLToPath(new URL("./__fixtures__/read-caller.ts", import.meta.url));
let outDir: string | undefined;

afterAll(async () => {
  if (outDir !== undefined) await rm(outDir, { recursive: true, force: true });
});

describe("T-025: чтение выписок из собранного бандла", () => {
  it("CSV, XLSX, PDF и скан читаются бандлом: рабочий файл статуса рядом, библиотеки из node_modules", async () => {
    // Папка внутри apps/server/dist (в .gitignore): внешние зависимости ищутся вверх по дереву, как в образе.
    await mkdir(join(serverDir, "dist"), { recursive: true });
    outDir = await mkdtemp(join(serverDir, "dist", "sandbox-test-"));
    const common: InlineConfig = {
      outDir,
      format: "esm",
      platform: "node",
      target: "node26",
      fixedExtension: true,
      dts: false,
      clean: false,
      logLevel: "silent",
      config: false,
      cwd: serverDir,
      deps: { alwaysBundle: [/^@kosht\//] },
    };
    await build({
      ...common,
      entry: { "statement-parse.worker": ENTRIES["statement-parse.worker"] },
    });
    await build({ ...common, entry: { caller } });
    const read = async (id: string, file: string, type: string) =>
      (
        await run("node", [join(outDir!, "caller.mjs"), join(dataset, id, file), type], {
          timeout: 60_000,
        })
      ).stdout.trim();
    expect(await read("lesbank-csv-september", "statement.csv", "csv")).toBe("table:34");
    expect(await read("puschabank-xlsx", "statement.xlsx", "xlsx")).toMatch(/^table:\d+$/);
    expect(await read("hamlet-xls-english", "statement.xls", "xls")).toMatch(/^table:\d+$/);
    expect(await read("lesbank-pdf-multipage", "statement.pdf", "pdf")).toMatch(/^table:\d+$/);
    expect(await read("scan-pdf", "statement.pdf", "pdf")).toBe("images:1");
  }, 120_000);
});
