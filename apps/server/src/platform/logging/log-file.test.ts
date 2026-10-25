// Файл лога на диске: параметры ротации (OBS-06) и канарейки «ПД не попали в лог» (OBS-04) — по тексту файла,
// а не по объектам в памяти: так видно всё, что реально записано.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { withLogContext } from "./context.ts";
import type { LogFields } from "./fields.ts";
import { closeLogFile, createLogger, openLogFile, rollOptions } from "./logger.ts";

const dir = mkdtempSync(join(tmpdir(), "kosht-logs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("OBS-06: ротация логов", () => {
  it("ежедневно, при ротации — счёт по всем файлам роли в папке, файл 0600", () => {
    expect(rollOptions("/data/logs", "worker")).toEqual({
      file: "/data/logs/worker",
      frequency: "daily",
      dateFormat: "yyyy-MM-dd",
      extension: ".log",
      limit: { count: 13, removeOtherLogFiles: true },
      mode: 0o600,
    });
  });

  it("при открытии остаётся 14 файлов роли: текущий и 13 новейших прошлых; файлы другой роли целы", async () => {
    const logDir = join(dir, "retention");
    mkdirSync(logDir, { recursive: true });
    const old = Array.from(
      { length: 20 },
      (_, i) => `api.2026-01-${String(i + 1).padStart(2, "0")}.1.log`,
    );
    for (const name of [
      ...old,
      "api.2026-01-20.2.log",
      "worker.2026-01-01.1.log",
      "api.notes.txt",
    ]) {
      writeFileSync(join(logDir, name), "{}\n");
    }
    const stream = await openLogFile(logDir, "api");
    const current = basename(stream.file ?? "");
    await closeLogFile(stream);
    const apiLogs = readdirSync(logDir).filter((name) => /^api\..+\.log$/.test(name));
    expect(apiLogs.sort()).toEqual([current, "api.2026-01-20.2.log", ...old.slice(8)].sort());
    expect(readdirSync(logDir)).toEqual(
      expect.arrayContaining(["worker.2026-01-01.1.log", "api.notes.txt"]),
    );
  });

  it("файл роли — <роль>.<гггг-ММ-дд>.<n>.log с правами 0600, папка 0700 создаётся сама", async () => {
    const logDir = join(dir, "roll", "logs");
    const stream = await openLogFile(logDir, "api");
    createLogger({ role: "api", level: "info", destination: stream }).info({}, "process.started");
    await closeLogFile(stream);
    const files = readdirSync(logDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^api\.\d{4}-\d{2}-\d{2}\.1\.log$/);
    const file = join(logDir, files[0] ?? "");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(logDir).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ msg: "process.started" });
  });
});

describe("OBS-04: канарейки — личные данные не попадают в файл лога", () => {
  it("email, номер карты, сумма, текст документа и значение строки в ошибке БД", async () => {
    const logDir = join(dir, "canary");
    const stream = await openLogFile(logDir, "worker");
    const log = createLogger({ role: "worker", level: "trace", destination: stream });
    const email = "canary.ivan@mail.example.by";
    const card = "4111 1111 1111 1111";
    const amount = 98_765_432;
    const documentText = "ООО Канарейка, молоко 3,2 % 2,49 BYN";
    const rowValue = "Сырок канареечный 1,17";
    const dbError = Object.assign(
      new Error(`duplicate key value violates unique constraint, value ${rowValue}`),
      {
        severity: "ERROR",
        code: "23505",
        detail: `Key (name)=(${rowValue}) already exists.`,
        constraint: "items_name_key",
        table: "items",
      },
    );
    withLogContext({ requestId: "req-canary-1", source: "job" }, () => {
      // Обход типа (as): так поля пришли бы из JS или any — проверяется защита при записи.
      log.info({ email, amount, text: documentText } as LogFields, "receipt.saved");
      log.warn({ err: new Error(`вход не удался: ${email}, карта ${card}`) }, "auth.login.failed");
      log.error({ err: dbError }, "receipt.save-failed");
      (log.info as (fields: object, key: string) => void)({}, `чек ${documentText}`);
    });
    await closeLogFile(stream);
    const text = readdirSync(logDir)
      .map((file) => readFileSync(join(logDir, file), "utf8"))
      .join("");
    expect(text.split("\n").filter(Boolean)).toHaveLength(4);
    for (const secret of [email, card, card.replaceAll(" ", ""), String(amount), documentText]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(rowValue);
    expect(text).not.toContain("Канарейка");
    expect(text).toContain('"code":"23505"');
    expect(text).toContain('"requestId":"req-canary-1"');
  });
});
