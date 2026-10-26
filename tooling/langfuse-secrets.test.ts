// make init → секреты Langfuse (ADR-0010, NFR-16): значения случайные и создаются один раз, файлы 0600, пароли
// хранилищ в env-файлах Langfuse и самих хранилищ совпадают, ключи проекта — те, что читает приложение.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ensureLangfuseSecrets,
  generateLangfuseSecrets,
  LANGFUSE_ADMIN_EMAIL,
  S3_ACCESS_KEY,
} from "./langfuse-secrets.ts";

const root = mkdtempSync(join(tmpdir(), "kosht-langfuse-secrets-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function envOf(file: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

describe("NFR-16, ADR-0010: секреты Langfuse из make init", () => {
  const dir = join(root, "secrets");

  it("создаются все файлы 0600 в папке 0700; пароли согласованы между сервисами", () => {
    expect(ensureLangfuseSecrets(dir)).toEqual({ created: true });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const name of [
      "langfuse.json",
      "langfuse_public_key",
      "langfuse_secret_key",
      "langfuse_admin_password",
      "langfuse.env",
      "langfuse-db.env",
      "langfuse-clickhouse.env",
      "langfuse-valkey.env",
      "langfuse-s3.env",
    ]) {
      expect({ name, mode: statSync(join(dir, name)).mode & 0o777 }).toEqual({ name, mode: 0o600 });
    }
    const web = envOf(join(dir, "langfuse.env"));
    const db = envOf(join(dir, "langfuse-db.env"));
    expect(web["DATABASE_URL"]).toBe(
      `postgresql://langfuse:${db["POSTGRES_PASSWORD"] ?? "?"}@langfuse-db:5432/langfuse`,
    );
    expect(web["CLICKHOUSE_PASSWORD"]).toBe(
      envOf(join(dir, "langfuse-clickhouse.env"))["CLICKHOUSE_PASSWORD"],
    );
    expect(web["REDIS_AUTH"]).toBe(envOf(join(dir, "langfuse-valkey.env"))["VALKEY_PASSWORD"]);
    expect(envOf(join(dir, "langfuse-s3.env"))).toEqual({
      AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
      AWS_SECRET_ACCESS_KEY: web["LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY"],
    });
    expect(web["LANGFUSE_INIT_PROJECT_PUBLIC_KEY"]).toBe(
      readFileSync(join(dir, "langfuse_public_key"), "utf8").trim(),
    );
    expect(web["LANGFUSE_INIT_PROJECT_SECRET_KEY"]).toBe(
      readFileSync(join(dir, "langfuse_secret_key"), "utf8").trim(),
    );
    expect(web["LANGFUSE_INIT_USER_EMAIL"]).toBe(LANGFUSE_ADMIN_EMAIL);
    expect(web["ENCRYPTION_KEY"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("повторный запуск не меняет значения и чинит права файлов", () => {
    const before = readFileSync(join(dir, "langfuse.env"), "utf8");
    writeFileSync(join(dir, "langfuse.env"), "испорчено\n", { mode: 0o644 });
    expect(ensureLangfuseSecrets(dir)).toEqual({ created: false });
    expect(readFileSync(join(dir, "langfuse.env"), "utf8")).toBe(before);
    expect(statSync(join(dir, "langfuse.env")).mode & 0o777).toBe(0o600);
  });

  it("значения случайные: две установки не совпадают ни в одном секрете", () => {
    const a = generateLangfuseSecrets();
    const b = generateLangfuseSecrets();
    for (const key of Object.keys(a) as (keyof typeof a)[]) expect(a[key]).not.toBe(b[key]);
    expect(a.publicKey).toMatch(/^pk-lf-/);
    expect(a.secretKey).toMatch(/^sk-lf-/);
  });
});
