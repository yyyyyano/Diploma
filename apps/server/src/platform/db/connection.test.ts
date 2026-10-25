import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { connectionOptions } from "./connection.ts";

const dir = mkdtempSync(join(tmpdir(), "kosht-db-connection-"));
const passwordFile = join(dir, "db_password");
writeFileSync(passwordFile, "s3cret-from-file\n");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("NFR-16: подключение к БД — адрес из окружения, пароль из файла", () => {
  it("разбирает DATABASE_URL на части и берёт пароль из файла без перевода строки", () => {
    const options = connectionOptions({
      url: "postgres://kosht@127.0.0.1:5441/kosht",
      passwordFile,
    });
    expect(options).toEqual({
      host: "127.0.0.1",
      port: 5441,
      user: "kosht",
      database: "kosht",
      password: "s3cret-from-file",
    });
  });

  it("другая база на том же сервере — для тестовых баз test_*", () => {
    const options = connectionOptions(
      { url: "postgres://kosht@localhost/kosht", passwordFile },
      "test_1",
    );
    expect(options).toMatchObject({ host: "localhost", port: 5432, database: "test_1" });
  });

  it("пароль в DATABASE_URL отвергается, и в тексте ошибки его нет", () => {
    const run = () =>
      connectionOptions({ url: "postgres://kosht:leak@127.0.0.1/kosht", passwordFile });
    expect(run).toThrow(/не должен содержать пароль/);
    expect(run).not.toThrow(/leak/);
  });

  it("нет файла пароля — подсказка выполнить make init", () => {
    const run = () =>
      connectionOptions({
        url: "postgres://kosht@127.0.0.1/kosht",
        passwordFile: join(dir, "нет"),
      });
    expect(run).toThrow(/make init/);
  });

  it("не postgres:// — понятная ошибка", () => {
    expect(() => connectionOptions({ url: "mysql://kosht@127.0.0.1/kosht", passwordFile })).toThrow(
      /ожидается адрес postgres/,
    );
  });
});
