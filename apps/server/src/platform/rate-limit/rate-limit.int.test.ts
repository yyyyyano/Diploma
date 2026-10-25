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

function limiterOn(
  pool: Parameters<typeof createSystemDb>[0],
  clock = new FakeClock("2026-10-21T09:00:00Z"),
  timeoutMs = 2_000,
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

  it("enforce: превышение — RATE_LIMITED с retryAfterSeconds", async () => {
    const { limiter } = limiterOn(db.pool);
    for (let i = 0; i < 3; i += 1) await limiter.enforce(RESET, EMAIL);
    await expect(limiter.enforce(RESET, EMAIL)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      params: { retryAfterSeconds: 3600 },
    });
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
