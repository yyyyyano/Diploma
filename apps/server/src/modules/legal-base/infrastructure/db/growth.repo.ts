// Пополнение каталога (LAW-11…17): кандидаты, добавление актов, граф ссылок, проверка появления текста, журнал спроса и
// отметки проходов — только SystemDb модуля. Сети внутри нет.
import { gunzipSync } from "node:zlib";
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { CandidateSource } from "../../domain/routes.ts";
import { one } from "./rows.ts";
import {
  legalActSnapshots,
  legalActs,
  legalCandidates,
  legalDemandLog,
  legalGrowthMarks,
  type ActSource,
  type CandidateState,
} from "./schema.ts";

export interface CandidateRow {
  readonly id: string;
  readonly pravoId: string;
  readonly title: string | null;
  readonly kindLine: string | null;
  readonly registryNo: string | null;
  readonly source: CandidateSource;
  readonly foundOn: string | null;
}

export interface NewCandidate {
  readonly pravoId: string;
  readonly title?: string;
  readonly kindLine?: string;
  readonly registryNo?: string | null;
}

/** Какие из ID уже есть в каталоге. */
export async function knownActIds(db: SystemDb, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ pravoId: legalActs.pravoId })
    .from(legalActs)
    .where(inArray(legalActs.pravoId, [...ids]));
  return new Set(rows.map((r) => r.pravoId));
}

/**
 * Найденные кандидаты ждут проверки (`found`). Уже известные каталогу, отклонённые администратором и отсеянные раньше не
 * заводятся заново (LAW-17: отклонённые повторно не предлагаются). Возвращает, сколько заведено.
 */
export async function addFoundCandidates(
  db: SystemDb,
  items: readonly NewCandidate[],
  source: CandidateSource,
  foundOn: string | null,
): Promise<number> {
  const unique = [...new Map(items.map((i) => [i.pravoId, i])).values()];
  const known = await knownActIds(
    db,
    unique.map((i) => i.pravoId),
  );
  const fresh = unique.filter((i) => !known.has(i.pravoId));
  if (fresh.length === 0) return 0;
  const rows = await db
    .insert(legalCandidates)
    .values(
      fresh.map((i) => ({
        pravoId: i.pravoId,
        title: i.title ?? null,
        kindLine: i.kindLine ?? null,
        registryNo: i.registryNo ?? null,
        source,
        foundOn,
      })),
    )
    .onConflictDoNothing({ target: legalCandidates.pravoId })
    .returning({ id: legalCandidates.id });
  return rows.length;
}

/** Кандидаты, ожидающие проверки фильтрами: самые давние первыми, не больше `limit` за проход. */
export async function foundCandidates(db: SystemDb, limit: number): Promise<CandidateRow[]> {
  const rows = await db
    .select({
      id: legalCandidates.id,
      pravoId: legalCandidates.pravoId,
      title: legalCandidates.title,
      kindLine: legalCandidates.kindLine,
      registryNo: legalCandidates.registryNo,
      source: legalCandidates.source,
      foundOn: legalCandidates.foundOn,
    })
    .from(legalCandidates)
    .where(eq(legalCandidates.status, "found"))
    .orderBy(asc(legalCandidates.createdAt), asc(legalCandidates.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, source: r.source as CandidateSource }));
}

export async function decideCandidate(
  db: SystemDb,
  id: string,
  patch: {
    status: Exclude<CandidateState, "found">;
    reason?: string | null;
    title?: string | null;
    kindLine?: string | null;
    hasText?: boolean | null;
    topic?: string | null;
    topicSource?: string | null;
  },
  at: Date,
): Promise<void> {
  await db
    .update(legalCandidates)
    .set({ ...patch, decidedAt: at })
    .where(eq(legalCandidates.id, id));
}

/** Кандидат из очереди администратора для акта, уже лежащего в каталоге (журнал спроса, ведомственные страницы). */
export async function queueCandidate(
  db: SystemDb,
  item: NewCandidate & { source: CandidateSource; reason: string; hasText?: boolean },
  at: Date,
): Promise<boolean> {
  const rows = await db
    .insert(legalCandidates)
    .values({
      pravoId: item.pravoId,
      title: item.title ?? null,
      source: item.source,
      status: "queued",
      reason: item.reason,
      hasText: item.hasText ?? null,
      decidedAt: at,
    })
    .onConflictDoNothing({ target: legalCandidates.pravoId })
    .returning({ id: legalCandidates.id });
  return rows.length === 1;
}

export interface NewAct {
  readonly pravoId: string;
  readonly title: string;
  readonly kind: string;
  readonly isNpa: boolean;
  readonly hasText: boolean;
  readonly source: ActSource;
  readonly topic: string | null;
  readonly topicSource: string | null;
}

/** Завести акт в каталог: с текстом — «ждёт загрузки», без текста — «только карточка». Уже известный акт не трогается. */
export async function addAct(db: SystemDb, act: NewAct): Promise<boolean> {
  const rows = await db
    .insert(legalActs)
    .values({ ...act, loadState: act.hasText ? "pending" : "card-only" })
    .onConflictDoNothing({ target: legalActs.pravoId })
    .returning({ id: legalActs.id });
  return rows.length === 1;
}

/** Загруженные акты, у которых текущий снимок ещё не разобран на ссылки (LAW-11). */
export async function actsToScanLinks(db: SystemDb): Promise<{ id: string; pravoId: string }[]> {
  return db
    .select({ id: legalActs.id, pravoId: legalActs.pravoId })
    .from(legalActs)
    .where(
      and(
        eq(legalActs.loadState, "loaded"),
        sql`${legalActs.currentSnapshotId} is not null`,
        or(
          isNull(legalActs.linksScannedSnapshotId),
          ne(legalActs.linksScannedSnapshotId, legalActs.currentSnapshotId),
        ),
      ),
    )
    .orderBy(legalActs.pravoId);
}

/** Текущий снимок акта: id (отметка «ссылки извлечены») и HTML. */
export async function currentSnapshotHtml(
  db: SystemDb,
  actId: string,
): Promise<{ snapshotId: string; html: string }> {
  const row = one(
    await db
      .select({ snapshotId: legalActSnapshots.id, rawGz: legalActSnapshots.rawGz })
      .from(legalActs)
      .innerJoin(legalActSnapshots, eq(legalActSnapshots.id, legalActs.currentSnapshotId))
      .where(eq(legalActs.id, actId)),
    "legal_act_snapshots",
  );
  return { snapshotId: row.snapshotId, html: gunzipSync(row.rawGz).toString("utf8") };
}

export async function markLinksScanned(
  db: SystemDb,
  actId: string,
  snapshotId: string,
): Promise<void> {
  await db
    .update(legalActs)
    .set({ linksScannedSnapshotId: snapshotId })
    .where(eq(legalActs.id, actId));
}

/** Акты каталога по ID pravo.by (изменяемые акты — цель внеплановой проверки, LAW-12). */
export async function actsByPravoIds(
  db: SystemDb,
  ids: readonly string[],
): Promise<{ id: string; pravoId: string; hasText: boolean; loadState: string }[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: legalActs.id,
      pravoId: legalActs.pravoId,
      hasText: legalActs.hasText,
      loadState: legalActs.loadState,
    })
    .from(legalActs)
    .where(and(inArray(legalActs.pravoId, [...ids]), eq(legalActs.status, "active")));
}

/** Акты новых поступлений без текста, у которых пора проверить, не появился ли он: не старше `since`, проверялись до `before`. */
export async function actsAwaitingText(
  db: SystemDb,
  opts: { since: Date; before: Date },
): Promise<{ id: string; pravoId: string; title: string }[]> {
  return db
    .select({ id: legalActs.id, pravoId: legalActs.pravoId, title: legalActs.title })
    .from(legalActs)
    .where(
      and(
        eq(legalActs.source, "new-arrivals"),
        eq(legalActs.hasText, false),
        eq(legalActs.status, "active"),
        gte(legalActs.createdAt, opts.since),
        or(isNull(legalActs.textCheckedAt), lt(legalActs.textCheckedAt, opts.before)),
      ),
    )
    .orderBy(legalActs.createdAt, legalActs.pravoId);
}

export async function markTextChecked(db: SystemDb, actId: string, at: Date): Promise<void> {
  await db.update(legalActs).set({ textCheckedAt: at }).where(eq(legalActs.id, actId));
}

/** Текст у акта появился и тема определена: акт переходит в «ждёт загрузки» (LAW-17). */
export async function enableText(
  db: SystemDb,
  actId: string,
  topic: { topic: string; topicSource: string },
): Promise<void> {
  await db
    .update(legalActs)
    .set({ hasText: true, loadState: "pending", lastProblem: null, ...topic })
    .where(eq(legalActs.id, actId));
}

// ── Журнал спроса и отметки ───────────────────────────────────────────────────────────────────

export async function addDemand(
  db: SystemDb,
  entry: { at: Date; topic: string; pravoIds: readonly string[] },
): Promise<void> {
  await db
    .insert(legalDemandLog)
    .values({ at: entry.at, topic: entry.topic, pravoIds: [...entry.pravoIds] });
}

export async function demandSince(
  db: SystemDb,
  since: Date,
): Promise<{ topic: string; pravoIds: string[] }[]> {
  return db
    .select({ topic: legalDemandLog.topic, pravoIds: legalDemandLog.pravoIds })
    .from(legalDemandLog)
    .where(gte(legalDemandLog.at, since))
    .orderBy(legalDemandLog.at);
}

export async function readMark(
  db: SystemDb,
  key: string,
): Promise<{ day: string | null; at: Date | null } | undefined> {
  const rows = await db
    .select({ day: legalGrowthMarks.day, at: legalGrowthMarks.at })
    .from(legalGrowthMarks)
    .where(eq(legalGrowthMarks.key, key));
  return rows[0];
}

export async function writeMark(
  db: SystemDb,
  key: string,
  value: { day?: string; at?: Date },
): Promise<void> {
  await db
    .insert(legalGrowthMarks)
    .values({ key, day: value.day ?? null, at: value.at ?? null })
    .onConflictDoUpdate({
      target: legalGrowthMarks.key,
      set: { day: value.day ?? null, at: value.at ?? null },
    });
}
