// T-027: подготовка фото чека работает и из собранного образа. Рабочий файл собирается по настоящей точке входа
// `receipt-prepare.worker` из tsdown.config.ts, вызывающий бандл находит `receipt-prepare.worker.mjs` рядом с собой;
// sharp, heic-decode и zxing-wasm — внешние, из node_modules приложения, а zxing_reader.wasm читается с диска, не с CDN.
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
const dataset = fileURLToPath(new URL("../../../../../../../datasets/receipts/", import.meta.url));
const caller = fileURLToPath(new URL("./__fixtures__/prepare-caller.ts", import.meta.url));
let outDir: string | undefined;

afterAll(async () => {
  if (outDir !== undefined) await rm(outDir, { recursive: true, force: true });
});

describe("T-027: подготовка фото чека из собранного бандла", () => {
  it("JPEG, PNG и HEIC читаются бандлом, QR находится", async () => {
    await mkdir(join(serverDir, "dist"), { recursive: true });
    outDir = await mkdtemp(join(serverDir, "dist", "receipt-test-"));
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
      entry: { "receipt-prepare.worker": ENTRIES["receipt-prepare.worker"] },
    });
    await build({ ...common, entry: { caller } });
    const prepare = async (id: string, file: string, type: string) =>
      (
        await run("node", [join(outDir!, "caller.mjs"), join(dataset, id, file), type], {
          timeout: 90_000,
        })
      ).stdout.trim();
    expect(await prepare("sosnovy-clean-card", "receipt.jpg", "jpg")).toBe("image/jpeg codes:1");
    expect(await prepare("listok-screenshot-png", "receipt.png", "png")).toBe("image/jpeg codes:1");
    expect(await prepare("zelenaya-iphone-heic", "receipt.heic", "heic")).toBe(
      "image/jpeg codes:1",
    );
    expect(await prepare("listok-no-qr", "receipt.jpg", "jpg")).toBe("image/jpeg codes:0");
  }, 180_000);
});
