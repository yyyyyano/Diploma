// T-025: поток разбора работает и из собранного образа. tsdown собирает вызывающий код и рабочий файл так же, как
// apps/server/tsdown.config.ts (по бандлу на точку входа, `<имя>.worker.mjs` рядом), и бандл запускается обычным node.
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "tsdown";
import { afterAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const fixtures = fileURLToPath(new URL("./__fixtures__/", import.meta.url));
let outDir: string | undefined;

afterAll(async () => {
  if (outDir !== undefined) await rm(outDir, { recursive: true, force: true });
});

describe("SEC-03: песочница в собранном бандле", () => {
  it("бандл вызывающего кода находит рядом echo.worker.mjs и получает ответ потока", async () => {
    outDir = await mkdtemp(join(tmpdir(), "kosht-sandbox-build-"));
    for (const [name, file] of [
      ["caller", "caller.ts"],
      ["echo.worker", "echo.worker.ts"],
    ] as const) {
      await build({
        entry: { [name]: join(fixtures, file) },
        outDir,
        format: "esm",
        platform: "node",
        target: "node26",
        fixedExtension: true,
        dts: false,
        clean: false,
        logLevel: "silent",
        config: false,
      });
    }
    const { stdout } = await run("node", [join(outDir, "caller.mjs")], { timeout: 30_000 });
    expect(stdout.trim()).toBe("из бандла");
  }, 60_000);
});
