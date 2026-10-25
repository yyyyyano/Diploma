// make init → secrets/master.key (NFR-16, ADR-0016): 32 случайных байта, права 0600, существующий ключ не трогается
// (иначе сохранённые в админке секреты стали бы «не читается»). Цель запускается в пустой временной папке.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const makefile = fileURLToPath(new URL("../Makefile", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "kosht-master-key-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const makeKey = () =>
  execFileSync("make", ["-s", "-f", makefile, "-C", dir, "secrets/master.key"], {
    encoding: "utf8",
  });

describe("NFR-16: make init создаёт мастер-ключ", () => {
  it("32 случайных байта, файл 0600, папка secrets 0700", () => {
    expect(makeKey()).toContain("Создан secrets/master.key");
    const key = join(dir, "secrets", "master.key");
    expect(readFileSync(key)).toHaveLength(32);
    expect(statSync(key).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "secrets")).mode & 0o777).toBe(0o700);
  });

  it("существующий ключ не меняется", () => {
    makeKey();
    const key = join(dir, "secrets", "master.key");
    const before = readFileSync(key);
    makeKey();
    expect(readFileSync(key).equals(before)).toBe(true);
  });
});
