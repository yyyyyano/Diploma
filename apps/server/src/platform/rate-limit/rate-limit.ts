// Ограничение частоты (SEC-02, ADR-0016): вход, сброс пароля, код восстановления, ассистент. Счётчики — в Postgres
// (общие для api, worker, bot), окно — фиксированное, по Clock. Ключ (email, user_id) хранится только как
// HMAC-SHA-256 с ключом из мастер-ключа: простой хеш email подбирается словарём. В HMAC входит и имя правила —
// правила изолированы друг от друга. БД недоступна или не ответила вовремя — UNAVAILABLE, а не «пропустить»:
// иначе отказ базы снимал бы защиту от перебора.
import type { Clock } from "@kosht/kernel";
import { createHmac } from "node:crypto";
import type { MasterKey } from "../config/master-key.ts";
import type { SystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import type { Logger } from "../logging/logger.ts";
import { bump } from "./rate-limit.repo.ts";

const RULE_NAME = /^[a-z]+(\.[a-z0-9-]+)+$/;
/** Сколько ждать базу, прежде чем ответить UNAVAILABLE. */
export const RATE_LIMIT_TIMEOUT_MS = 2_000;

export interface RateRule {
  /** Имя: `auth.login`. */
  readonly name: string;
  /** Сколько попыток пропускается в окне. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateDecision {
  readonly allowed: boolean;
  /** Сколько попыток ещё осталось в этом окне. */
  readonly remaining: number;
  /** Через сколько откроется следующее окно (для заголовка Retry-After и текста ошибки). */
  readonly retryAfterMs: number;
}

/** Правило с проверкой: имя — ключ события, лимит и окно — положительные целые. */
export function defineRateRule(rule: RateRule): RateRule {
  if (!RULE_NAME.test(rule.name)) {
    throw new RangeError(`Имя правила «${rule.name}»: ожидается вида auth.login.`);
  }
  if (!Number.isInteger(rule.limit) || rule.limit < 1) {
    throw new RangeError(`Правило ${rule.name}: limit — целое ≥ 1.`);
  }
  if (!Number.isInteger(rule.windowMs) || rule.windowMs < 1_000) {
    throw new RangeError(`Правило ${rule.name}: windowMs — целое ≥ 1000.`);
  }
  return rule;
}

export interface RateLimiter {
  /** Засчитать попытку; БД недоступна — AppError UNAVAILABLE. */
  hit(rule: RateRule, subject: string): Promise<RateDecision>;
  /** То же, но превышение — AppError RATE_LIMITED с retryAfterSeconds и retryAfterMinutes (текст «через N мин.»). */
  enforce(rule: RateRule, subject: string): Promise<void>;
}

export interface RateLimiterDeps {
  readonly db: SystemDb;
  readonly clock: Pick<Clock, "now">;
  readonly masterKey: MasterKey;
  readonly log: Logger;
  readonly timeoutMs?: number;
}

export function createRateLimiter(deps: RateLimiterDeps): RateLimiter {
  const hmacKey = deps.masterKey.derive("rate-limit/v1");
  const timeoutMs = deps.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS;

  /** HMAC(правило, ключ): email в разном регистре и форме Unicode — один ключ. */
  function keyHash(rule: RateRule, subject: string): Buffer {
    return createHmac("sha256", hmacKey)
      .update(rule.name)
      .update("\0")
      .update(subject.normalize("NFC").trim().toLowerCase())
      .digest();
  }

  async function hit(rule: RateRule, subject: string): Promise<RateDecision> {
    const now = deps.clock.now().getTime();
    const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
    let count: number;
    try {
      count = await withTimeout(
        bump(deps.db, rule.name, keyHash(rule, subject), new Date(windowStart)),
        timeoutMs,
      );
    } catch (error) {
      // Баг запроса (аудитор SQL) не маскируется под «база недоступна» (ARCHITECTURE §6.2).
      if ((error as { code?: unknown }).code === "ISOLATION_VIOLATION") throw error;
      deps.log.warn({ rule: rule.name, err: error }, "ratelimit.unavailable");
      throw new AppError("UNAVAILABLE", {}, { cause: error });
    }
    const allowed = count <= rule.limit;
    if (!allowed) deps.log.info({ rule: rule.name, count }, "ratelimit.exceeded");
    return {
      allowed,
      remaining: Math.max(0, rule.limit - count),
      retryAfterMs: allowed ? 0 : windowStart + rule.windowMs - now,
    };
  }

  return {
    hit,
    async enforce(rule, subject) {
      const decision = await hit(rule, subject);
      if (!decision.allowed) {
        const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
        throw new AppError("RATE_LIMITED", {
          retryAfterSeconds,
          retryAfterMinutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)),
        });
      }
    },
  };
}

/** Обещание или TimeoutError через ms (таймер реальный: это ожидание сети, а не «сегодня»). */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`rate_limits: нет ответа базы за ${String(ms)} мс`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
