// Счётчик окна (SEC-02): один атомарный upsert на попытку — параллельные попытки сериализуются блокировкой строки,
// поэтому из N одновременных пропускается ровно limit. Окно сменилось — строка того же ключа перезаписывается
// (count = 1). Строки других ключей того же правила из прошлых окон удаляются перед upsert, не больше PURGE_BATCH
// за попытку: ключ — HMAC email, и перебор разных адресов иначе копил бы строки без конца. Строки правила, по
// которому попыток больше нет, остаются (их число ограничено числом правил × ключей последнего окна).
// Запросы — через SystemDb, проходят аудитор.
import { sql } from "drizzle-orm";
import type { SystemDb } from "../db/system-db.ts";
import { rateLimits } from "./schema.ts";

/** Сколько просроченных строк удаляется за одну попытку. */
export const PURGE_BATCH = 100;

/** Засчитать попытку и вернуть число попыток в текущем окне (включая эту). */
export async function bump(
  db: SystemDb,
  rule: string,
  keyHash: Buffer,
  windowStart: Date,
): Promise<number> {
  await purgeExpired(db, rule, keyHash, windowStart);
  const rows = await db
    .insert(rateLimits)
    .values({ rule, keyHash, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.rule, rateLimits.keyHash],
      set: {
        // Окно в базе не моложе пришедшего (часы процессов чуть расходятся) — то же окно, +1; иначе новое окно.
        count: sql`case when ${rateLimits.windowStart} >= excluded.window_start
          then ${rateLimits.count} + 1 else 1 end`,
        windowStart: sql`greatest(${rateLimits.windowStart}, excluded.window_start)`,
      },
    })
    .returning({ count: rateLimits.count });
  const row = rows[0];
  if (row === undefined) throw new Error("rate_limits: upsert не вернул строку.");
  return row.count;
}

/**
 * Удалить до PURGE_BATCH строк правила из прошлых окон (окна правила выровнены: всё, что начато раньше текущего,
 * истекло). Свой ключ не трогается — его перезапишет upsert; занятые другой попыткой строки пропускаются
 * (SKIP LOCKED), чтобы параллельные попытки не ждали друг друга.
 */
async function purgeExpired(
  db: SystemDb,
  rule: string,
  keyHash: Buffer,
  windowStart: Date,
): Promise<void> {
  await db.delete(rateLimits).where(
    sql`ctid = any(array(
      select ctid from ${rateLimits}
      where ${rateLimits.rule} = ${rule} and ${rateLimits.windowStart} < ${windowStart}
        and ${rateLimits.keyHash} <> ${keyHash}
      limit ${PURGE_BATCH} for update skip locked))`,
  );
}
