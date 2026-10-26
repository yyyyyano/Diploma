// make init на существующем .env (ADR-0020): старые умолчания владельца заменяются на роль приложения, переменные
// владельца дописываются; свои значения разработчика не трогаются. Программа работает на копиях во временной
// папке — настоящий .env тест не читает.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { APPEND, NEW_DEFAULTS, parseFacts, upgradeEnv } from "./upgrade-env.ts";

const script = fileURLToPath(new URL("upgrade-env.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "kosht-upgrade-env-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const OLD_ENV = [
  "DB_PORT=5440",
  "DATABASE_URL=postgres://kosht@127.0.0.1:5440/kosht",
  "# Файл пароля БД",
  "DB_PASSWORD_FILE=secrets/db_password",
  "LOG_LEVEL=debug",
  "GROQ_API_KEY=секрет-разработчика",
  "",
].join("\n");

describe("ADR-0020: make init обновляет старый .env", () => {
  it("старые умолчания владельца → роль приложения, MIGRATION_* дописаны, остальное как было", () => {
    const upgrade = upgradeEnv(OLD_ENV);
    expect(upgrade.replaced).toEqual(["DATABASE_URL", "DB_PASSWORD_FILE"]);
    expect(upgrade.appended).toEqual(["MIGRATION_DATABASE_URL", "MIGRATION_DB_PASSWORD_FILE"]);
    expect(upgrade.text).toContain("DATABASE_URL=postgres://kosht_app@127.0.0.1:5440/kosht\n");
    expect(upgrade.text).toContain("DB_PASSWORD_FILE=secrets/db_app_password\n");
    expect(upgrade.text).toContain(
      "MIGRATION_DATABASE_URL=postgres://kosht@127.0.0.1:5440/kosht\n",
    );
    expect(upgrade.text).toContain("MIGRATION_DB_PASSWORD_FILE=secrets/db_password\n");
    expect(upgrade.text).toContain("LOG_LEVEL=debug\nGROQ_API_KEY=секрет-разработчика\n");
    expect(upgrade.text.endsWith("\n")).toBe(true);
  });

  it("повторный запуск ничего не меняет", () => {
    const once = upgradeEnv(OLD_ENV).text;
    const twice = upgradeEnv(once);
    expect(twice.text).toBe(once);
    expect([...twice.replaced, ...twice.appended]).toEqual([]);
  });

  it("свой адрес разработчика не заменяется; значение в кавычках сравнивается без кавычек", () => {
    const upgrade = upgradeEnv(
      'DATABASE_URL=postgres://me@127.0.0.1:5441/kosht\nDB_PASSWORD_FILE="secrets/db_password"\n',
    );
    expect(upgrade.replaced).toEqual(["DB_PASSWORD_FILE"]);
    expect(upgrade.text).toContain("DATABASE_URL=postgres://me@127.0.0.1:5441/kosht\n");
  });

  it("новые значения и дописанные переменные совпадают с .env.example", () => {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    for (const [name, value] of Object.entries({ ...NEW_DEFAULTS, ...APPEND })) {
      expect(example).toContain(`\n${name}=${value}\n`);
    }
  });

  it("программа правит файл на месте, сохраняет права и печатает только имена переменных", () => {
    const file = join(dir, ".env");
    writeFileSync(file, OLD_ENV);
    chmodSync(file, 0o600);
    const out = execFileSync(process.execPath, [script, file], { encoding: "utf8" });
    expect(out).toContain("DATABASE_URL, DB_PASSWORD_FILE");
    expect(out).toContain("MIGRATION_DATABASE_URL, MIGRATION_DB_PASSWORD_FILE");
    expect(out).not.toMatch(/postgres:|secrets\/|секрет-разработчика/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe(upgradeEnv(OLD_ENV).text);
    expect(execFileSync(process.execPath, [script, file], { encoding: "utf8" })).toContain(
      "уже актуален",
    );
  });
});

describe("ADR-0015: make init пишет в .env факты машины для Compose", () => {
  it("нет переменных — дописываются; повтор с теми же значениями ничего не меняет", () => {
    const first = upgradeEnv("LOG_LEVEL=info\n", { RENDER_GID: "989", APP_UID: "1000" });
    expect(first.host).toEqual(["RENDER_GID", "APP_UID"]);
    expect(first.text).toContain("\nRENDER_GID=989\nAPP_UID=1000\n");
    const again = upgradeEnv(first.text, { RENDER_GID: "989", APP_UID: "1000" });
    expect(again.host).toEqual([]);
    expect(again.text).toBe(first.text);
  });

  it("значение по умолчанию из .env.example заменяется значением этой машины, на месте", () => {
    const upgrade = upgradeEnv("RENDER_GID=992\nAPP_GID=1000\n", { RENDER_GID: "44" });
    expect(upgrade.text.startsWith("RENDER_GID=44\nAPP_GID=1000\n")).toBe(true);
    expect(upgrade.host).toEqual(["RENDER_GID"]);
  });

  it("аргументы: только известные имена и целые числа; пустое значение (группы нет) пропускается", () => {
    expect(parseFacts(["RENDER_GID=", "APP_UID=1000"])).toEqual({ APP_UID: "1000" });
    expect(() => parseFacts(["PATH=/bin"])).toThrow(RangeError);
    expect(() => parseFacts(["APP_UID=1000;rm"])).toThrow(RangeError);
  });

  it("переменные фактов есть в .env.example со значениями по умолчанию Compose", () => {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    for (const line of ["RENDER_GID=992", "APP_UID=1000", "APP_GID=1000"]) {
      expect(example).toContain(`\n${line}\n`);
    }
  });
});
