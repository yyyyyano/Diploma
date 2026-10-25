// «process.env читают только config и точки входа» (ARCHITECTURE §9): иначе переменная обходит Zod-схему и
// падение при старте с понятным сообщением. Тесты и фикстуры не проверяются — им окружение нужно для globalSetup.
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_SRC = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWED = [/^platform\/config\//, /^entrypoints\//, /\.test\.ts$/, /\/__fixtures__\//];

describe("ARCHITECTURE §9: окружение читает только конфигурация", () => {
  it("process.env встречается только в platform/config, entrypoints и тестах", () => {
    const files = globSync("**/*.ts", { cwd: SERVER_SRC });
    expect(files.length).toBeGreaterThan(20);
    const readers = files.filter(
      (file) =>
        !ALLOWED.some((allowed) => allowed.test(file)) &&
        /\bprocess\s*\.\s*env\b|\bprocess\s*\[\s*["']env["']\s*\]/.test(
          readFileSync(new URL(file, `file://${SERVER_SRC}`), "utf8"),
        ),
    );
    expect(readers).toEqual([]);
  });
});
