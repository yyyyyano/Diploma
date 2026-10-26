import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIG_VARIABLES, ConfigError, loadConfig, loadDbConfig } from "./config.ts";

const dir = mkdtempSync(join(tmpdir(), "kosht-config-"));
const keyFile = join(dir, "master.key");
writeFileSync(keyFile, Buffer.alloc(32, 7));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Окружение теста: мастер-ключ из временной папки и переданные переменные. */
const env = (vars: Record<string, string> = {}) => ({ MASTER_KEY_FILE: keyFile, ...vars });

/** Текст ConfigError; другой исход — ошибка теста. */
function failure(run: () => unknown): string {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof ConfigError)) throw new Error("ожидалась ConfigError", { cause: caught });
  return caught.message;
}

describe("NFR-16, ADR-0015: конфигурация окружения", () => {
  it("без переменных — умолчания make dev и .env.example", () => {
    const config = loadConfig(env());
    expect(config).toMatchObject({
      db: {
        app: {
          url: "postgres://kosht_app@127.0.0.1:5440/kosht",
          passwordFile: "secrets/db_app_password",
        },
        migration: {
          url: "postgres://kosht@127.0.0.1:5440/kosht",
          passwordFile: "secrets/db_password",
        },
      },
      listeners: {
        local: { host: "127.0.0.1", port: 8140 },
        lan: { host: "0.0.0.0", port: 8141 },
      },
      trustedOrigins: [],
      webDistDir: resolve("apps/web/dist"),
      dataDir: resolve("data"),
      logLevel: "info",
    });
  });

  it("пустая переменная — как не заданная", () => {
    expect(loadConfig(env({ LISTEN_LOCAL_PORT: "", DATA_DIR: "" })).listeners.local.port).toBe(
      8140,
    );
  });

  it("читает слушатели, доверенные origin и папку данных", () => {
    const config = loadConfig(
      env({
        LISTEN_LOCAL_HOST: "0.0.0.0",
        LISTEN_LOCAL_PORT: "0",
        LISTEN_LAN_HOST: "::",
        LISTEN_LAN_PORT: "9141",
        TRUSTED_ORIGINS: "http://192.168.1.5:8141, https://kosht.local",
        DATA_DIR: "/srv/kosht",
        WEB_DIST_DIR: "/srv/kosht-web",
        LOG_LEVEL: "debug",
      }),
    );
    expect(config.listeners).toEqual({
      local: { host: "0.0.0.0", port: 0 },
      lan: { host: "::", port: 9141 },
    });
    expect(config.trustedOrigins).toEqual(["http://192.168.1.5:8141", "https://kosht.local"]);
    expect(config.dataDir).toBe("/srv/kosht");
    expect(config.webDistDir).toBe("/srv/kosht-web");
    expect(config.logLevel).toBe("debug");
  });

  it.each([
    ["LISTEN_LOCAL_PORT", "абв", "ожидается целое число 0…65535"],
    ["LISTEN_LAN_PORT", "70000", "ожидается целое число 0…65535"],
    ["LISTEN_LOCAL_HOST", "localhost", "ожидается IP-адрес"],
    ["LISTEN_LAN_HOST", "999.1.1.1", "ожидается IP-адрес"],
    ["TRUSTED_ORIGINS", "http://a.local/путь", "ожидаются origin через запятую"],
    ["TRUSTED_ORIGINS", "ftp://a.local", "ожидаются origin через запятую"],
    ["LOG_LEVEL", "verbose", "ожидается одно из: fatal, error"],
    ["DATABASE_URL", "mysql://kosht@127.0.0.1/kosht", "ожидается адрес postgres://"],
    ["MIGRATION_DATABASE_URL", "mysql://kosht@127.0.0.1/kosht", "ожидается адрес postgres://"],
  ])("%s=%s → падение с именем переменной и ожиданием", (name, value, expected) => {
    const message = failure(() => loadConfig(env({ [name]: value })));
    expect(message).toContain(`${name}: ${expected}`);
  });

  it("пароль в DATABASE_URL отвергается, и в тексте ошибки его нет", () => {
    const message = failure(() =>
      loadConfig(env({ DATABASE_URL: "postgres://kosht:leak-123@127.0.0.1/kosht" })),
    );
    expect(message).toContain("DATABASE_URL: ожидается адрес postgres://");
    expect(message).not.toContain("leak-123");
  });

  it("несколько ошибок сообщаются разом", () => {
    const message = failure(() => loadConfig(env({ LISTEN_LOCAL_PORT: "x", LOG_LEVEL: "y" })));
    expect(message).toContain("LISTEN_LOCAL_PORT:");
    expect(message).toContain("LOG_LEVEL:");
  });

  it("нет файла мастер-ключа → падение с MASTER_KEY_FILE и подсказкой make init", () => {
    const message = failure(() => loadConfig({ MASTER_KEY_FILE: join(dir, "нет.key") }));
    expect(message).toMatch(
      /^MASTER_KEY_FILE \(.*нет\.key\): файл не прочитан — выполните make init/,
    );
  });

  it("мастер-ключ не 32 байта → падение с MASTER_KEY_FILE и ожиданием", () => {
    const short = join(dir, "short.key");
    writeFileSync(short, Buffer.alloc(16, 1));
    expect(failure(() => loadConfig({ MASTER_KEY_FILE: short }))).toContain(
      "ожидается ровно 32 байта, получено 16",
    );
  });

  it("мастер-ключ не виден ни в JSON, ни в inspect конфигурации", () => {
    const config = loadConfig(env());
    const bytes = Buffer.alloc(32, 7).toString("hex");
    expect(JSON.stringify(config)).toContain('"masterKey":"[MasterKey]"');
    expect(inspect(config, { depth: 5 })).not.toContain("0707");
    expect(JSON.stringify(config)).not.toContain(bytes);
  });

  it("env отдаёт переменную по имени, пустую — как отсутствие", () => {
    const config = loadConfig(env({ GROQ_API_KEY: "k-1", TIME_ZONE: "" }));
    expect(config.env("GROQ_API_KEY")).toBe("k-1");
    expect(config.env("TIME_ZONE")).toBeUndefined();
    expect(() => config.env("groq key")).toThrow(RangeError);
  });
});

describe("loadDbConfig: только подключение к БД (ADR-0020: две роли одной базы)", () => {
  it("не требует мастер-ключа — make migrate и тесты работают без secrets/master.key", () => {
    expect(loadDbConfig({ MASTER_KEY_FILE: join(dir, "нет.key") })).toEqual({
      app: {
        url: "postgres://kosht_app@127.0.0.1:5440/kosht",
        passwordFile: "secrets/db_app_password",
      },
      migration: {
        url: "postgres://kosht@127.0.0.1:5440/kosht",
        passwordFile: "secrets/db_password",
      },
      migrationsDir: resolve("apps/server/drizzle"),
    });
  });

  it("берёт DATABASE_URL, DB_PASSWORD_FILE и MIGRATION_*", () => {
    expect(
      loadDbConfig({
        DATABASE_URL: "postgres://kosht_app@db:5432/kosht",
        DB_PASSWORD_FILE: "/run/a",
        MIGRATION_DATABASE_URL: "postgres://kosht@db/kosht",
        MIGRATION_DB_PASSWORD_FILE: "/run/p",
        MIGRATIONS_DIR: "/app/drizzle",
      }),
    ).toEqual({
      app: { url: "postgres://kosht_app@db:5432/kosht", passwordFile: "/run/a" },
      migration: { url: "postgres://kosht@db/kosht", passwordFile: "/run/p" },
      migrationsDir: "/app/drizzle",
    });
  });

  it("неверный DATABASE_URL → падение с именем переменной", () => {
    expect(failure(() => loadDbConfig({ DATABASE_URL: "не адрес" }))).toContain(
      "DATABASE_URL: ожидается адрес postgres://",
    );
  });

  it.each([
    ["хост", "postgres://kosht_app@10.0.0.9:5440/kosht"],
    ["порт", "postgres://kosht_app@127.0.0.1:5441/kosht"],
    ["база", "postgres://kosht_app@127.0.0.1:5440/other"],
  ])(
    "другой %s у DATABASE_URL и MIGRATION_DATABASE_URL → ConfigError без значений",
    (_what, url) => {
      const message = failure(() => loadDbConfig({ DATABASE_URL: url }));
      expect(message).toContain("хост, порт и база должны совпадать");
      expect(message).not.toMatch(/10\.0\.0\.9|5441|other|kosht_app/);
    },
  );

  it("старый .env: обе переменные — владелец kosht → ConfigError с подсказкой make init", () => {
    const message = failure(() =>
      loadDbConfig({
        DATABASE_URL: "postgres://kosht@127.0.0.1:5440/kosht",
        DB_PASSWORD_FILE: "secrets/db_password",
      }),
    );
    expect(message).toContain("роли должны различаться");
    expect(message).toContain("make init");
  });
});

describe(".env.example и схема конфигурации", () => {
  const example = readFileSync(new URL("../../../../../.env.example", import.meta.url), "utf8");
  const vars = Object.fromEntries(
    [...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );

  it("каждая переменная схемы есть в .env.example, и лишних нет (DB_PORT — только для Compose)", () => {
    expect(
      Object.keys(vars)
        .filter((name) => name !== "DB_PORT")
        .toSorted(),
    ).toEqual(CONFIG_VARIABLES.toSorted());
  });

  it("значения из .env.example проходят схему и совпадают с умолчаниями", () => {
    // Сравнение через JSON: функция env и мастер-ключ в нём не видны, остальное — значения.
    expect(JSON.stringify(loadConfig({ ...vars, MASTER_KEY_FILE: keyFile }))).toBe(
      JSON.stringify(loadConfig(env())),
    );
  });
});
