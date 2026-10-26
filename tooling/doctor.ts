// make doctor (NFR-14, ADR-0015): готова ли машина к make dev и make up — Node и pnpm нужных версий, Docker Engine
// (не Desktop: в виртуальной машине Desktop нет iGPU для моделей) не старше 28.3.3 (уязвимость портов 127.0.0.1
// после перезагрузки firewalld), пользователь в группах docker и render, свободны порты 8140–8143, 5440, 3001 и 5173
// (Vite make dev: strictPort — занят чужим процессом, и make dev остановится).
// Порт, занятый контейнером этого проекта (compose kosht), — свободен: это наш запущенный стек.
// Код выхода: 0 — всё готово; 1 — есть что исправить (каждая строка ✖ — с подсказкой).
//   node tooling/doctor.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

/** Порты стека (ADR-0015): api local/lan, llama-server, whisper.cpp, Postgres, Langfuse, Vite make dev. */
export const PORTS = [8140, 8141, 8142, 8143, 5440, 3001, 5173] as const;
export const MIN_DOCKER = "28.3.3";
export const GROUPS = ["docker", "render"] as const;

export interface Check {
  readonly ok: boolean;
  readonly label: string;
  /** Что сделать, если не ok. */
  readonly hint?: string;
}

/** Сравнение версий вида 28.3.3 (суффиксы вроде -rc1 отбрасываются): <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split(/[-+]/)[0]
      ?.split(".")
      .map((n) => Number.parseInt(n, 10) || 0) ?? [];
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function checkNode(actual: string, required: string): Check {
  const ok = actual.split(".")[0] === required.split(".")[0];
  return {
    ok,
    label: `Node ${actual} (нужен ${required})`,
    hint: `nvm install ${required} && nvm use ${required}`,
  };
}

export function checkPnpm(actual: string | undefined, required: string): Check {
  return {
    ok: actual === required,
    label: `pnpm ${actual ?? "не найден"} (нужен ${required})`,
    hint: `npm install --global pnpm@${required}`,
  };
}

/** Docker: найден, Engine (не Desktop), версия сервера ≥ MIN_DOCKER. */
export function checkDocker(info: { os: string; version: string } | undefined): Check[] {
  if (info === undefined) {
    return [
      {
        ok: false,
        label: "Docker не отвечает",
        hint: "установите Docker Engine (docs.docker.com/engine/install) и запустите: sudo systemctl enable --now docker",
      },
    ];
  }
  return [
    {
      ok: !/docker desktop/i.test(info.os),
      label: `Docker: ${info.os}`,
      hint:
        "нужен Docker Engine, а не Desktop (iGPU в виртуальную машину Desktop не пробрасывается): " +
        "docker context use default",
    },
    {
      ok: compareVersions(info.version, MIN_DOCKER) >= 0,
      label: `Docker ${info.version} (нужен ≥ ${MIN_DOCKER})`,
      hint: "обновите Docker Engine: до 28.3.3 порты 127.0.0.1 открывались наружу после перезагрузки firewalld",
    },
  ];
}

/**
 * Группы docker и render: членство по базе групп (id -nG <пользователь>); если в базе есть, а у текущего сеанса ещё
 * нет — тоже ✖: права появятся только после нового входа в систему.
 */
export function checkGroups(memberOf: readonly string[], session: readonly string[]): Check[] {
  return GROUPS.map((group) => {
    if (!memberOf.includes(group)) {
      return {
        ok: false,
        label: `группа ${group}`,
        hint: `sudo usermod -aG ${group} $USER — и войдите в систему заново`,
      };
    }
    return {
      ok: session.includes(group),
      label: session.includes(group) ? `группа ${group}` : `группа ${group} — ещё не в этом сеансе`,
      hint: "вы уже в группе, но сеанс старый: выйдите из системы и войдите снова",
    };
  });
}

/** Порт свободен, если его никто не держит или держит контейнер этого проекта. */
export function checkPorts(busy: ReadonlySet<number>, ownPorts: ReadonlySet<number>): Check[] {
  return PORTS.map((port) => {
    const own = busy.has(port) && ownPorts.has(port);
    return {
      ok: !busy.has(port) || own,
      label: own ? `порт ${port} — у запущенного стека kosht` : `порт ${port}`,
      hint: `порт занят другой программой: ss -ltnp 'sport = :${port}' — освободите его`,
    };
  });
}

/** Опубликованные порты контейнеров проекта из `docker compose ps --format json` (строка JSON на контейнер). */
export function projectPorts(psJson: string): Set<number> {
  const ports = new Set<number>();
  for (const line of psJson.split("\n")) {
    if (line.trim() === "") continue;
    const container = JSON.parse(line) as { Publishers?: { PublishedPort?: number }[] };
    for (const publisher of container.Publishers ?? []) {
      if (publisher.PublishedPort !== undefined && publisher.PublishedPort > 0) {
        ports.add(publisher.PublishedPort);
      }
    }
  }
  return ports;
}

async function isBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(false)));
  });
}

function run(command: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const nodeVersion = readFileSync(`${root}.node-version`, "utf8").trim();
  const packageManager = (
    JSON.parse(readFileSync(`${root}package.json`, "utf8")) as { packageManager: string }
  ).packageManager;
  const os = run("docker", ["info", "--format", "{{.OperatingSystem}}"]);
  const version = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  const busy = new Set<number>();
  for (const port of PORTS) if (await isBusy(port)) busy.add(port);
  const own = projectPorts(
    run("docker", ["compose", "--project-directory", root, "ps", "--format", "json"]) ?? "",
  );
  const checks = [
    checkNode(process.versions.node, nodeVersion),
    checkPnpm(run("pnpm", ["--version"]), packageManager.replace(/^pnpm@/, "")),
    ...checkDocker(os === undefined || version === undefined ? undefined : { os, version }),
    ...checkGroups(
      (run("id", ["-nG", run("id", ["-un"]) ?? ""]) ?? "").split(/\s+/),
      (run("id", ["-nG"]) ?? "").split(/\s+/),
    ),
    ...checkPorts(busy, own),
  ];
  for (const check of checks) {
    process.stdout.write(
      check.ok ? `✔ ${check.label}\n` : `✖ ${check.label}\n    → ${check.hint ?? ""}\n`,
    );
  }
  const failed = checks.filter((check) => !check.ok).length;
  process.stdout.write(
    failed === 0 ? "Машина готова: make dev или make up.\n" : `Исправьте пунктов: ${failed}.\n`,
  );
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
