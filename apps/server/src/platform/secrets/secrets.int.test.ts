import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MasterKey } from "../config/master-key.ts";
import { createSystemDb } from "../db/system-db.ts";
import { toErrorBody } from "../errors/app-error.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { createSecrets, defineSecret } from "./secrets.ts";

const GROQ = defineSecret({ name: "test.groq-key", env: "TEST_GROQ_API_KEY" });
const SMTP = defineSecret({ name: "test.smtp-password" });
/** Значение-канарейка: его не должно быть ни в логе, ни в базе открытым текстом, ни в ответах. */
const CANARY = "gsk_canary_7f3a9c1e5b2d4f60";

const KEY_A = MasterKey.fromBytes(Buffer.alloc(32, 0xa1));
const KEY_B = MasterKey.fromBytes(Buffer.alloc(32, 0xb2));

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.pool.query("delete from secrets");
});

function secretsWith(masterKey: MasterKey, env: Record<string, string> = {}) {
  const logs = memoryLogger();
  const secrets = createSecrets({
    db: createSystemDb(db.pool),
    masterKey,
    env: (name) => env[name],
    clock: new FakeClock("2026-10-21T09:00:00Z"),
    log: logs.log,
  });
  return { secrets, logs };
}

describe("NFR-16: секрет — только для записи, наружу «задан / не задан»", () => {
  it("не задан → unset; задан в админке → set, значение доступно коду", async () => {
    const { secrets } = secretsWith(KEY_A);
    expect(await secrets.status(GROQ)).toBe("unset");
    await secrets.set(GROQ, CANARY);
    expect(await secrets.status(GROQ)).toBe("set");
    expect(await secrets.reveal(GROQ)).toBe(CANARY);
  });

  it("приоритет «админка > env»: env действует, пока в админке пусто", async () => {
    const { secrets } = secretsWith(KEY_A, { TEST_GROQ_API_KEY: "from-env" });
    expect(await secrets.status(GROQ)).toBe("set");
    expect(await secrets.reveal(GROQ)).toBe("from-env");
    await secrets.set(GROQ, CANARY);
    expect(await secrets.reveal(GROQ)).toBe(CANARY);
    await secrets.clear(GROQ);
    expect(await secrets.reveal(GROQ)).toBe("from-env");
  });

  it("в базе — шифротекст AES-256-GCM: открытого значения нет, IV свежий на каждую запись", async () => {
    const { secrets } = secretsWith(KEY_A);
    await secrets.set(GROQ, CANARY);
    const first = await db.pool.query<{ iv: Buffer; tag: Buffer; ciphertext: Buffer }>(
      "select iv, tag, ciphertext from secrets where name = $1",
      [GROQ.name],
    );
    await secrets.set(GROQ, CANARY);
    const second = await db.pool.query<{ iv: Buffer; ciphertext: Buffer }>(
      "select iv, ciphertext from secrets where name = $1",
      [GROQ.name],
    );
    const row = first.rows[0];
    expect(row?.iv).toHaveLength(12);
    expect(row?.tag).toHaveLength(16);
    expect(row?.ciphertext.toString("utf8")).not.toContain(CANARY);
    expect(second.rows[0]?.iv.equals(row?.iv ?? Buffer.alloc(0))).toBe(false);
    expect(second.rows[0]?.ciphertext.equals(row?.ciphertext ?? Buffer.alloc(0))).toBe(false);
  });

  it("пустое и слишком длинное значение — VALIDATION без значения в ответе", async () => {
    const { secrets } = secretsWith(KEY_A);
    await expect(secrets.set(GROQ, "")).rejects.toMatchObject({ code: "VALIDATION" });
    const tooLong = `${CANARY}${"x".repeat(5000)}`;
    const error: unknown = await secrets.set(GROQ, tooLong).catch((thrown: unknown) => thrown);
    expect(JSON.stringify(toErrorBody(error, "req-1"))).not.toContain(CANARY);
    expect(String(error)).not.toContain(CANARY);
  });
});

describe("NFR-16: чужой мастер-ключ или порча — «не читается», процесс не падает", () => {
  it("другой мастер-ключ → unreadable, reveal — env или ничего", async () => {
    await secretsWith(KEY_A).secrets.set(GROQ, CANARY);
    const { secrets, logs } = secretsWith(KEY_B, { TEST_GROQ_API_KEY: "from-env" });
    expect(await secrets.status(GROQ)).toBe("unreadable");
    expect(await secrets.reveal(GROQ)).toBe("from-env");
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ msg: "secrets.unreadable", secret: "test.groq-key" }),
    );
  });

  it("испорченный шифротекст → unreadable", async () => {
    const { secrets } = secretsWith(KEY_A);
    await secrets.set(SMTP, CANARY);
    await db.pool.query(
      "update secrets set ciphertext = set_byte(ciphertext, 0, (get_byte(ciphertext, 0) + 1) % 256) where name = $1",
      [SMTP.name],
    );
    expect(await secrets.status(SMTP)).toBe("unreadable");
    expect(await secrets.reveal(SMTP)).toBeUndefined();
  });

  it("шифротекст одного секрета под именем другого не читается (AAD = имя)", async () => {
    const { secrets } = secretsWith(KEY_A);
    await secrets.set(GROQ, CANARY);
    await db.pool.query(
      "insert into secrets (name, iv, tag, ciphertext, updated_at) select $2, iv, tag, ciphertext, updated_at from secrets where name = $1",
      [GROQ.name, SMTP.name],
    );
    expect(await secrets.status(SMTP)).toBe("unreadable");
  });
});

describe("OBS-04: канарейка — значение секрета не встречается в логах", () => {
  it("запись, чтение, сбой расшифровки и ошибка проверки — в логе нет значения", async () => {
    const a = secretsWith(KEY_A);
    await a.secrets.set(GROQ, CANARY);
    await a.secrets.reveal(GROQ);
    await a.secrets.status(GROQ);
    await expect(a.secrets.set(GROQ, `${CANARY}${"x".repeat(5000)}`)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const b = secretsWith(KEY_B);
    await b.secrets.reveal(GROQ);
    await a.secrets.clear(GROQ);
    const text = a.logs.text() + b.logs.text();
    expect(text).toContain("secrets.changed");
    expect(text).toContain("secrets.unreadable");
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(CANARY.slice(4, 20));
  });
});

describe("defineSecret", () => {
  it("имя не по форме, повтор имени и неверная переменная — ошибка регистрации", () => {
    expect(() => defineSecret({ name: "Groq Key" })).toThrow(RangeError);
    expect(() => defineSecret({ name: GROQ.name })).toThrow(/объявлен дважды/);
    expect(() => defineSecret({ name: "test.bad-env", env: "lower" })).toThrow(RangeError);
  });
});
