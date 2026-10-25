// make init → secrets/db_app_password (NFR-16, ADR-0020): пароль роли приложения kosht_app — 32 случайных байта в
// hex, права 0600, существующий не меняется (им уже входит запущенное приложение). Цель — в пустой временной папке.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const makefile = fileURLToPath(new URL("../Makefile", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "kosht-db-app-password-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const make = () =>
  execFileSync("make", ["-s", "-f", makefile, "-C", dir, "secrets/db_app_password"], {
    encoding: "utf8",
  });

describe("NFR-16, ADR-0020: make init создаёт пароль роли приложения", () => {
  it("64 hex-символа (32 байта), файл 0600, папка secrets 0700", () => {
    expect(make()).toContain("Создан secrets/db_app_password");
    const file = join(dir, "secrets", "db_app_password");
    expect(readFileSync(file, "utf8")).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "secrets")).mode & 0o777).toBe(0o700);
  });

  it("существующий пароль не меняется", () => {
    make();
    const file = join(dir, "secrets", "db_app_password");
    const before = readFileSync(file, "utf8");
    make();
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
