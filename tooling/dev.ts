// make dev (ADR-0015, режим А): инфраструктура уже в контейнерах (make поднял db и Langfuse), здесь — код на хосте:
// api, worker и bot под `node --watch` (переменные — из .env, его читает node) и Vite на 127.0.0.1:5173 с прокси
// /api → 127.0.0.1:8140. TRUSTED_ORIGINS программа не задаёт: сайт и /api идут с одного origin (прокси без
// changeOrigin), и лишний доверенный origin не нужен (T-008). Ctrl+C — SIGINT всем, ждём их выхода; упал один —
// останавливаются остальные, код 1.
//   node tooling/dev.ts
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface DevProcess {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** Процессы режима make dev; root — корень репозитория. */
export function devProcesses(root: string, node: string = process.execPath): DevProcess[] {
  const server = (role: "api" | "worker" | "bot"): DevProcess => ({
    name: role,
    command: node,
    args: ["--watch", "--env-file-if-exists=.env", `apps/server/src/entrypoints/${role}.ts`],
    cwd: root,
  });
  return [
    server("api"),
    server("worker"),
    server("bot"),
    // Хост, порт и прокси — в apps/web/vite.config.ts (strictPort: занят — понятная ошибка, а не другой порт).
    { name: "web", command: node, args: ["node_modules/vite/bin/vite.js"], cwd: `${root}apps/web` },
  ];
}

function main(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const children = new Map<string, ChildProcess>();
  let stopping = false;
  let code = 0;
  const stopAll = (signal: NodeJS.Signals) => {
    stopping = true;
    for (const child of children.values()) if (child.exitCode === null) child.kill(signal);
  };
  for (const proc of devProcesses(root)) {
    const child = spawn(proc.command, proc.args, { cwd: proc.cwd, stdio: "inherit" });
    children.set(proc.name, child);
    child.once("exit", (exitCode, signal) => {
      children.delete(proc.name);
      if (!stopping) {
        process.stderr.write(
          `make dev: ${proc.name} остановился (${exitCode ?? signal ?? "?"}) — останавливаю остальные.\n`,
        );
        code = 1;
        stopAll("SIGTERM");
      }
      if (children.size === 0) process.exit(code);
    });
  }
  // Ctrl+C терминал шлёт всей группе процессов; здесь — только перестать реагировать на их выход как на сбой.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (!stopping) stopAll(signal);
    });
  }
}

if (import.meta.main) main();
