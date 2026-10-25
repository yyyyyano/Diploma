// Счётчик окна (SEC-02): один атомарный upsert на попытку — параллельные попытки сериализуются блокировкой строки,
// поэтому из N одновременных пропускается ровно limit. Окно сменилось — строка того же ключа перезаписывается
// (count = 1): так просроченная строка удаляется при записи в тот же ключ; прочие просроченные убирает задача
// очистки (T-006). Запрос — через SystemDb, проходит аудитор.
import { sql } from "drizzle-orm";
import type { SystemDb } from "../db/system-db.ts";
import { rateLimits } from "./schema.ts";

/** Засчитать попытку и вернуть число попыток в текущем окне (включая эту). */
export async function bump(
  db: SystemDb,
  rule: string,
  keyHash: Buffer,
  windowStart: Date,
): Promise<number> {
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
