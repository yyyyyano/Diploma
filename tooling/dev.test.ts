// make dev (ADR-0015): код на хосте — api, worker, bot под node --watch с .env и Vite сайта; TRUSTED_ORIGINS
// программа не задаёт (T-008: сайт и /api — один origin через прокси Vite без changeOrigin).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { devProcesses } from "./dev.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("ADR-0015: процессы make dev", () => {
  const processes = devProcesses(root, "node");

  it("api, worker, bot — node --watch с .env; точки входа существуют", () => {
    for (const role of ["api", "worker", "bot"]) {
      const proc = processes.find((p) => p.name === role);
      expect(proc?.args.slice(0, 2)).toEqual(["--watch", "--env-file-if-exists=.env"]);
      expect(existsSync(`${root}${proc?.args[2] ?? ""}`)).toBe(true);
    }
  });

  it("Vite запускается из папки сайта (его конфиг: 127.0.0.1:5173, прокси /api)", () => {
    const web = processes.find((p) => p.name === "web");
    expect(web?.cwd).toBe(`${root}apps/web`);
    expect(existsSync(`${web?.cwd ?? ""}/${web?.args[0] ?? ""}`)).toBe(true);
  });

  it("окружение не подменяется: TRUSTED_ORIGINS и прочее — только из .env (по умолчанию пусто)", () => {
    expect(processes.every((p) => !("env" in p))).toBe(true);
    expect(JSON.stringify(processes)).not.toContain("TRUSTED_ORIGINS");
  });
});
