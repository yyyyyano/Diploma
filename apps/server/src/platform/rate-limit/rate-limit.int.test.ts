import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MasterKey } from "../config/master-key.ts";
import { createPool } from "../db/connection.ts";
import { createSystemDb } from "../db/system-db.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { PURGE_BATCH } from "./rate-limit.repo.ts";
import { createRateLimiter, defineRateRule } from "./rate-limit.ts";

const LOGIN = defineRateRule({ name: "auth.login", limit: 5, windowMs: 15 * 60_000 });
const RESET = defineRateRule({ name: "auth.reset", limit: 3, windowMs: 60 * 60_000 });
const KEY = MasterKey.fromBytes(Buffer.alloc(32, 0x5a));
const EMAIL = "ivan.canary@mail.example.by";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.pool.query("delete from rate_limits");
});

/**
 * Срок ожидания базы в тестах поведения — с запасом: под нагрузкой полного прогона (make check: int вместе с web) 50
 * параллельных попыток на маленьком пуле тестовой базы ждут дольше боевых 2 с, а проверяют атомарность, а не скорость.
 * Сам срок проверяют тесты «не ответила вовремя» — со своим малым значением.
 */
const BEHAVIOUR_TIMEOUT_MS = 15_000;

function limiterOn(
  pool: Parameters<typeof createSystemDb>[0],
  clock = new FakeClock("2026-10-21T09:00:00Z"),
  timeoutMs = BEHAVIOUR_TIMEOUT_MS,
) {
  const logs = memoryLogger();
  const limiter = createRateLimiter({
    db: createSystemDb(pool),
    clock,
    masterKey: KEY,
    log: logs.log,
    timeoutMs,
  });
  return { limiter, clock, logs };
}

describe("SEC-02: ограничение частоты", () => {
  it("50 параллельных попыток — пропущено ровно limit (атомарный upsert)", async () => {
    const { limiter } = limiterOn(db.pool);
    const decisions = await Promise.all(
      Array.from({ length: 50 }, async () => limiter.hit(LOGIN, EMAIL)),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(LOGIN.limit);
  });

  it("окно по Clock: после конца окна счёт начинается заново, просроченная строка перезаписана", async () => {
    const { limiter, clock } = limiterOn(db.pool);
    for (let i = 0; i < 6; i += 1) await limiter.hit(LOGIN, EMAIL);
    const blocked = await limiter.hit(LOGIN, EMAIL);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterMs).toBe(15 * 60_000);
    clock.advance(15 * 60_000);
    expect(await limiter.hit(LOGIN, EMAIL)).toMatchObject({ allowed: true, remaining: 4 });
    const rows = await db.pool.query("select count from rate_limits");
    expect(rows.rows).toEqual([{ count: 1 }]);
  });

  it("правила изолированы: исчерпанный вход не трогает сброс пароля", async () => {
    const { limiter } = limiterOn(db.pool);
    for (let i = 0; i < 6; i += 1) await limiter.hit(LOGIN, EMAIL);
    expect(await limiter.hit(RESET, EMAIL)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("ключ — без учёта регистра email; другой ключ — свой счётчик", async () => {
    const { limiter } = limiterOn(db.pool);
    for (let i = 0; i < 5; i += 1) await limiter.hit(LOGIN, EMAIL);
    expect((await limiter.hit(LOGIN, EMAIL.toUpperCase())).allowed).toBe(false);
    expect((await limiter.hit(LOGIN, "other@mail.example.by")).allowed).toBe(true);
  });

  it("ключ хранится HMAC: ни email, ни его sha256 в таблице нет", async () => {
    const { limiter } = limiterOn(db.pool);
    await limiter.hit(LOGIN, EMAIL);
    const rows = await db.pool.query<{ key_hash: Buffer }>("select key_hash from rate_limits");
    const stored = rows.rows[0]?.key_hash;
    const { createHash } = await import("node:crypto");
    expect(stored).toHaveLength(32);
    expect(stored?.toString("utf8")).not.toContain(EMAIL);
    expect(stored?.equals(createHash("sha256").update(EMAIL).digest())).toBe(false);
  });

  it("enforce: превышение — RATE_LIMITED с retryAfterSeconds и минутами для текста", async () => {
    const { limiter } = limiterOn(db.pool);
    for (let i = 0; i < 3; i += 1) await limiter.enforce(RESET, EMAIL);
    await expect(limiter.enforce(RESET, EMAIL)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      params: { retryAfterSeconds: 3600, retryAfterMinutes: 60 },
    });
  });
});

describe("SEC-02: просроченные строки чужих ключей удаляются при записи", () => {
  /** n строк правила rule с началом окна windowStart; ключи — синтетические 32 байта. */
  async function seed(rule: string, windowStart: string, n: number, from = 1): Promise<void> {
    await db.pool.query(
      `insert into rate_limits (rule, key_hash, window_start, count)
       select $1, decode(lpad(to_hex(g), 64, '0'), 'hex'), $2, 3 from generate_series($3::int, $4::int) g`,
      [rule, windowStart, from, from + n - 1],
    );
  }
  async function countRows(rule: string, windowStart: string): Promise<number> {
    const rows = await db.pool.query<{ n: string }>(
      "select count(*) as n from rate_limits where rule = $1 and window_start = $2",
      [rule, windowStart],
    );
    return Number(rows.rows[0]?.n);
  }

  it("строки прошлых окон того же правила удалены; текущее окно и другие правила — целы", async () => {
    const { limiter } = limiterOn(db.pool);
    await seed(LOGIN.name, "2026-10-21T08:45:00Z", 3);
    await seed(LOGIN.name, "2026-10-21T09:00:00Z", 2, 100);
    await seed(RESET.name, "2026-10-21T08:00:00Z", 2, 200);
    await limiter.hit(LOGIN, EMAIL);
    expect(await countRows(LOGIN.name, "2026-10-21T08:45:00Z")).toBe(0);
    expect(await countRows(LOGIN.name, "2026-10-21T09:00:00Z")).toBe(3);
    expect(await countRows(RESET.name, "2026-10-21T08:00:00Z")).toBe(2);
  });

  it(`за одну попытку удаляется не больше ${String(PURGE_BATCH)} строк — запись не ждёт большой очистки`, async () => {
    const { limiter } = limiterOn(db.pool);
    await seed(LOGIN.name, "2026-10-21T08:30:00Z", PURGE_BATCH + 50);
    await limiter.hit(LOGIN, EMAIL);
    expect(await countRows(LOGIN.name, "2026-10-21T08:30:00Z")).toBe(50);
    await limiter.hit(LOGIN, EMAIL);
    expect(await countRows(LOGIN.name, "2026-10-21T08:30:00Z")).toBe(0);
  });
});

describe("SEC-02: база недоступна — UNAVAILABLE, а не «пропустить»", () => {
  it("нет соединения с базой → UNAVAILABLE, в логе — правило, без ключа", async () => {
    // Порт 1 никто не слушает: соединение отклоняется сразу.
    const dir = mkdtempSync(join(tmpdir(), "kosht-dead-db-"));
    writeFileSync(join(dir, "password"), "x");
    const dead = createPool({
      url: "postgres://x@127.0.0.1:1/x",
      passwordFile: join(dir, "password"),
    });
    const { limiter, logs } = limiterOn(dead);
    await expect(limiter.hit(LOGIN, EMAIL)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ msg: "ratelimit.unavailable", rule: "auth.login" }),
    );
    expect(logs.text()).not.toContain(EMAIL);
    await dead.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("база не ответила вовремя (все соединения пула заняты) → UNAVAILABLE", async () => {
    const held = await Promise.all(
      Array.from({ length: db.pool.options.max ?? 4 }, async () => db.pool.connect()),
    );
    try {
      const { limiter } = limiterOn(db.pool, new FakeClock("2026-10-21T09:00:00Z"), 100);
      await expect(limiter.hit(LOGIN, EMAIL)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    } finally {
      for (const client of held) client.release();
    }
  });
});

describe("defineRateRule", () => {
  it("имя не по форме, лимит и окно не положительные целые — ошибка", () => {
    expect(() => defineRateRule({ name: "Login", limit: 5, windowMs: 60_000 })).toThrow(RangeError);
    expect(() => defineRateRule({ name: "auth.x", limit: 0, windowMs: 60_000 })).toThrow(
      RangeError,
    );
    expect(() => defineRateRule({ name: "auth.x", limit: 1, windowMs: 10 })).toThrow(RangeError);
  });
});
