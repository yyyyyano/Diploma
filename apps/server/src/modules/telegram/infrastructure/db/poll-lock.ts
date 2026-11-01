// Блокировка опроса Telegram (TG-10, ARCHITECTURE §3): опрашивает один экземпляр бота — иначе Telegram отвечает 409. Замок
// консультативный, на время открытой транзакции (`pg_try_advisory_xact_lock`): транзакция держит одно соединение пула,
// а потеря соединения (сеть, рестарт Postgres, kill процесса) освобождает замок сама. Пульс — `select 1` раз в
// HEARTBEAT_MS: оборванное соединение обнаруживается сразу, а не при следующем событии, и опрос останавливается (`lost`).
import { sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";

/** Ключ замка: свой на опрос бота (у загрузчика законов — 8_340_034, у спроса — свои). */
const POLL_LOCK_KEY = 7_340_052;

/** Как часто держатель проверяет, жив ли замок, мс. */
export const HEARTBEAT_MS = 5_000;

export interface PollLock {
  /** Решается, когда замок потерян (соединение оборвалось) — опрос нужно остановить. */
  readonly lost: Promise<void>;
  /** Отпустить замок (идемпотентно); возвращает, когда транзакция закрыта. */
  release(): Promise<void>;
}

/** Взять замок или вернуть `undefined`, если его держит другой экземпляр. */
export async function acquirePollLock(
  system: SystemDb,
  onError: (error: unknown) => void,
  heartbeatMs = HEARTBEAT_MS,
): Promise<PollLock | undefined> {
  const stop = new AbortController();
  const decided = Promise.withResolvers<boolean>();
  const lost = Promise.withResolvers<void>();
  const holder = system
    .transaction(async (tx) => {
      const result = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${POLL_LOCK_KEY}::bigint) as locked`,
      );
      const locked = result.rows[0]?.locked === true;
      decided.resolve(locked);
      if (!locked) return;
      while (!stop.signal.aborted) {
        await pause(heartbeatMs, stop.signal);
        if (!stop.signal.aborted) await tx.execute(sql`select 1`);
      }
    })
    .catch((error: unknown) => {
      // Сбой до решения — замка нет; после — замок потерян: оба случая останавливают опрос.
      onError(error);
      decided.resolve(false);
    })
    .finally(() => lost.resolve());
  if (!(await decided.promise)) {
    await holder;
    return undefined;
  }
  return {
    lost: lost.promise,
    async release() {
      stop.abort();
      await holder;
    },
  };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
