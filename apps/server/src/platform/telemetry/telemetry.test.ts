import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { createTelemetry, loadLangfuseTarget } from "./telemetry.ts";

const TARGET = {
  baseUrl: "http://127.0.0.1:3001",
  publicKey: "pk-lf-1",
  secretKey: () => "sk-lf-1",
};

describe("OBS-03: опции трасс вызова модели", () => {
  it("без Langfuse выключено, но functionId, userId и sessionId уже в опциях вызова", () => {
    const telemetry = createTelemetry();
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.options({ functionId: "chat", userId: "u-1", sessionId: "c-1" })).toEqual({
      telemetry: {
        isEnabled: false,
        functionId: "chat",
        includeRuntimeContext: { userId: true, sessionId: true },
      },
      runtimeContext: { userId: "u-1", sessionId: "c-1" },
    });
  });

  it("с Langfuse — включено", () => {
    const telemetry = createTelemetry(TARGET);
    expect(telemetry.enabled).toBe(true);
    expect(telemetry.options({ functionId: "chat" }).telemetry.isEnabled).toBe(true);
  });

  it("задача без пользователя (systemCaller) — без userId и sessionId", () => {
    expect(createTelemetry(TARGET).options({ functionId: "law.topic" }).runtimeContext).toEqual({});
  });
});

describe("ADR-0010: ключи Langfuse из файлов make init", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kosht-langfuse-"));
    await writeFile(join(dir, "pk"), "pk-lf-abc\n", { mode: 0o600 });
    await writeFile(join(dir, "sk"), "sk-lf-секрет\n", { mode: 0o600 });
    await writeFile(join(dir, "empty"), "", { mode: 0o600 });
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  const config = (pk: string, sk: string) => ({
    baseUrl: "http://127.0.0.1:3001",
    publicKeyFile: join(dir, pk),
    secretKeyFile: join(dir, sk),
  });

  it("оба файла есть — цель с ключами без перевода строки; секрет не виден в JSON и inspect", async () => {
    const target = await loadLangfuseTarget(config("pk", "sk"), memoryLogger().log);
    expect(target?.publicKey).toBe("pk-lf-abc");
    expect(target?.secretKey()).toBe("sk-lf-секрет");
    expect(JSON.stringify(target)).not.toContain("секрет");
    expect(inspect(target)).not.toContain("секрет");
  });

  it.each([
    ["нет файла секретного ключа", "pk", "нет"],
    ["пустой публичный ключ", "empty", "sk"],
  ])("%s — трассы выключены, в логе telemetry.langfuse-off без путей", async (_name, pk, sk) => {
    const memory = memoryLogger();
    expect(await loadLangfuseTarget(config(pk, sk), memory.log)).toBeUndefined();
    expect(memory.lines()).toContainEqual(
      expect.objectContaining({ msg: "telemetry.langfuse-off", reason: "LANGFUSE_KEYS_MISSING" }),
    );
    expect(memory.text()).not.toContain(dir);
  });

  it("Langfuse выключен конфигурацией — без чтения файлов и без записи в лог", async () => {
    const memory = memoryLogger();
    expect(await loadLangfuseTarget(undefined, memory.log)).toBeUndefined();
    expect(memory.lines()).toEqual([]);
  });
});
