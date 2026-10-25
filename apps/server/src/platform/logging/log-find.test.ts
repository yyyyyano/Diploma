import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findByRequestId } from "./log-find.ts";

// Фикстурные логи создаются здесь: *.log исключены из git (.gitignore), а строки должны быть ровно такими,
// как пишет logger.ts.
const dir = mkdtempSync(join(tmpdir(), "kosht-log-find-"));
const line = (fields: Record<string, unknown>) => JSON.stringify(fields);

beforeAll(() => {
  writeFileSync(
    join(dir, "api.2026-10-21.1.log"),
    [
      line({
        time: "2026-10-21T09:00:00.100Z",
        role: "api",
        requestId: "req-aaaa-1111",
        msg: "http.request",
      }),
      line({
        time: "2026-10-21T09:00:00.200Z",
        role: "api",
        requestId: "req-bbbb-2222",
        msg: "http.request",
      }),
      "{обрезанная строка",
      line({
        time: "2026-10-21T09:00:00.900Z",
        role: "api",
        requestId: "req-aaaa-1111",
        msg: "http.response",
      }),
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "worker.2026-10-21.1.log"),
    [
      line({
        time: "2026-10-21T09:00:00.500Z",
        role: "worker",
        requestId: "req-aaaa-1111",
        msg: "job.started",
      }),
      line({
        time: "2026-10-21T09:00:00.600Z",
        role: "worker",
        note: "req-aaaa-1111",
        msg: "job.noise",
      }),
    ].join("\n"),
  );
  writeFileSync(join(dir, "чужой файл.txt"), line({ requestId: "req-aaaa-1111", msg: "x.y" }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("OBS-01: make log-find находит путь запроса по всем ролям", () => {
  it("строки всех ролей с этим requestId — по времени; чужие поля, файлы и битые строки не мешают", async () => {
    const found = (await findByRequestId(dir, "req-aaaa-1111")).map(
      (text) => (JSON.parse(text) as { msg: string }).msg,
    );
    expect(found).toEqual(["http.request", "job.started", "http.response"]);
  });

  it("нет строк — пустой список", async () => {
    expect(await findByRequestId(dir, "req-cccc-3333")).toEqual([]);
  });

  it("id не по шаблону — понятная ошибка", async () => {
    await expect(findByRequestId(dir, "req; rm -rf")).rejects.toThrow(/8–64 символа/);
  });

  it("CLI печатает строки JSON; не нашёл — код 1", () => {
    const cli = fileURLToPath(new URL("log-find-cli.ts", import.meta.url));
    const out = execFileSync(process.execPath, [cli, dir, "req-bbbb-2222"], { encoding: "utf8" });
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(() =>
      execFileSync(process.execPath, [cli, dir, "req-cccc-3333"], { stdio: "pipe" }),
    ).toThrow(/Command failed/);
  });
});

describe("NFR-14: цель make log-find", () => {
  const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
  const make = (...args: string[]) =>
    execFileSync("make", ["-s", ...args], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });

  it("показывает строки запроса через pino-pretty", () => {
    const out = make("log-find", "id=req-aaaa-1111", `LOG_DIR=${dir}`);
    expect(out).toContain("http.request");
    expect(out).toContain("job.started");
    expect(out).not.toContain("req-bbbb-2222");
  });

  it("без id — подсказка и отказ", () => {
    expect(() => make("log-find", `LOG_DIR=${dir}`)).toThrow(/Укажите id/);
  });
});
