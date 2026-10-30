// Утрата силы (LAW-34), принятые, но не вступившие изменения (LAW-32) и догрузки по требованию (LAW-09) — только SystemDb.
import { gunzipSync } from "node:zlib";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { CardChange } from "../pravo-by/parse-card.ts";
import { one } from "./rows.ts";
import { legalActSnapshots, legalActs, legalDemandLoads, legalPendingChanges } from "./schema.ts";

/** Акт утратил силу с этого дня: выходит из поиска (статус), дата остаётся для ответа «утратил силу с …». */
export async function markRepealed(db: SystemDb, actId: string, day: string): Promise<boolean> {
  const rows = await db
    .update(legalActs)
    .set({ status: "repealed", repealedOn: day })
    .where(and(eq(legalActs.id, actId), eq(legalActs.status, "active")))
    .returning({ id: legalActs.id });
  return rows.length === 1;
}

export async function touchCardChecked(db: SystemDb, actId: string, at: Date): Promise<void> {
  await db.update(legalActs).set({ cardCheckedAt: at }).where(eq(legalActs.id, actId));
}

/** Размер и HTML последнего применённого снимка: размер — для лёгкой проверки HEAD, HTML — перечень вошедших изменений. */
export async function currentSnapshot(
  db: SystemDb,
  actId: string,
): Promise<{ rawBytes: number; html: string } | undefined> {
  const rows = await db
    .select({ rawBytes: legalActSnapshots.rawBytes, rawGz: legalActSnapshots.rawGz })
    .from(legalActs)
    .innerJoin(legalActSnapshots, eq(legalActSnapshots.id, legalActs.currentSnapshotId))
    .where(eq(legalActs.id, actId));
  const row = rows[0];
  return row === undefined
    ? undefined
    : { rawBytes: row.rawBytes, html: gunzipSync(row.rawGz).toString("utf8") };
}

export interface PendingChangeRow {
  readonly id: string;
  readonly changeKey: string;
  readonly description: string;
  readonly inForceOn: string | null;
  readonly articles: readonly string[];
  readonly firstSeenAt: Date;
  readonly analyzedAt: Date | null;
  readonly notifiedAt: Date | null;
}

/**
 * Сверить перечень изменяющих актов карточки с перечнем в тексте: нового в тексте нет — запись «ждёт» (первый раз —
 * `firstSeenAt`), вошло в текст — «отражено». Возвращает ждущие.
 */
export async function syncPendingChanges(
  db: SystemDb,
  actId: string,
  cardChanges: readonly CardChange[],
  reflected: ReadonlySet<string>,
  now: Date,
): Promise<readonly PendingChangeRow[]> {
  const waiting = cardChanges.filter((c) => !reflected.has(c.key));
  if (waiting.length > 0) {
    await db
      .insert(legalPendingChanges)
      .values(
        waiting.map((c) => ({
          actId,
          changeKey: c.key,
          description: c.description,
          firstSeenAt: now,
        })),
      )
      .onConflictDoNothing({ target: [legalPendingChanges.actId, legalPendingChanges.changeKey] });
  }
  const gone = cardChanges.filter((c) => reflected.has(c.key)).map((c) => c.key);
  if (gone.length > 0) {
    await db
      .update(legalPendingChanges)
      .set({ status: "reflected" })
      .where(
        and(eq(legalPendingChanges.actId, actId), inArray(legalPendingChanges.changeKey, gone)),
      );
  }
  return pendingChangesOf(db, actId);
}

export async function pendingChangesOf(
  db: SystemDb,
  actId: string,
): Promise<readonly PendingChangeRow[]> {
  return db
    .select({
      id: legalPendingChanges.id,
      changeKey: legalPendingChanges.changeKey,
      description: legalPendingChanges.description,
      inForceOn: legalPendingChanges.inForceOn,
      articles: legalPendingChanges.articles,
      firstSeenAt: legalPendingChanges.firstSeenAt,
      analyzedAt: legalPendingChanges.analyzedAt,
      notifiedAt: legalPendingChanges.notifiedAt,
    })
    .from(legalPendingChanges)
    .where(and(eq(legalPendingChanges.actId, actId), eq(legalPendingChanges.status, "pending")))
    .orderBy(legalPendingChanges.firstSeenAt, legalPendingChanges.changeKey);
}

/** Проверенный разбор изменяющего акта: статьи и дата вступления (только дословно найденные в тексте). */
export async function saveChangeAnalysis(
  db: SystemDb,
  id: string,
  analysis: { articles: readonly string[]; inForceOn: string | null },
  at: Date,
): Promise<void> {
  await db
    .update(legalPendingChanges)
    .set({ articles: [...analysis.articles], inForceOn: analysis.inForceOn, analyzedAt: at })
    .where(eq(legalPendingChanges.id, id));
}

export async function markChangeNotified(db: SystemDb, id: string, at: Date): Promise<void> {
  await db
    .update(legalPendingChanges)
    .set({ notifiedAt: at })
    .where(eq(legalPendingChanges.id, id));
}

/** Догрузки по требованию за последние сутки (LAW-09): предел — настройка. */
export async function demandLoadsSince(db: SystemDb, since: Date): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(legalDemandLoads)
    .where(gte(legalDemandLoads.at, since));
  return one(rows, "legal_demand_loads").n;
}

export async function recordDemandLoad(db: SystemDb, actId: string, at: Date): Promise<void> {
  await db.insert(legalDemandLoads).values({ actId, at });
}

/** Акты, которые ещё нечего проверять по карточке сегодня: индексные — раз в сутки, остальные — раз в неделю (LAW-30). */
export async function actsDueForCard(
  db: SystemDb,
  opts: { indexed: boolean; before: Date },
): Promise<{ id: string; pravoId: string }[]> {
  return db
    .select({ id: legalActs.id, pravoId: legalActs.pravoId })
    .from(legalActs)
    .where(
      and(
        eq(legalActs.status, "active"),
        opts.indexed ? eq(legalActs.loadState, "loaded") : sql`${legalActs.loadState} <> 'loaded'`,
        sql`(${legalActs.cardCheckedAt} is null or ${legalActs.cardCheckedAt} < ${opts.before})`,
      ),
    )
    .orderBy(legalActs.pravoId);
}
