// Секреты и реальные данные не попадают в git (NFR-16, NFR-18): проверяем .gitignore самим git.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));

function isIgnored(path: string): boolean {
  // `git check-ignore` проверяет путь по правилам .gitignore; файлу существовать не нужно.
  const result = spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: root });
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`git check-ignore: код ${result.status}`);
  return result.status === 0;
}

describe(".gitignore", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "secrets/master.key",
    "secrets/db_password",
    "data/files/x.pdf",
    "models/model.gguf",
    "samples/receipt.jpg",
  ])("%s не попадает в git", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it(".env.example остаётся в git", () => {
    expect(isIgnored(".env.example")).toBe(false);
  });
});
