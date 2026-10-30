// Чтение и запись для вкладки «Законы» (LAW-40): список актов с состоянием, журналы, очередь кандидатов, исключение акта. Только
// SystemDb модуля; в ответах — метаданные актов и коды, без текстов страниц.
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { CandidateSource } from "../../domain/routes.ts";
import {
  legalActSnapshots,
  legalActs,
  legalCandidates,
  legalFetchLog,
  legalPendingChanges,
  legalUpdateLog,
} from "./schema.ts";

export interface AdminActRow {
  readonly pravoId: string;
  readonly title: string;
  readonly topic: string | null;
  readonly hasText: boolean;
  readonly status: string;
  readonly loadState: string;
  readonly lastProblem: string | null;
  readonly repealedOn: string | null;
  readonly editionAt: Date | null;
  readonly cardCheckedAt: Date | null;
  readonly pending: number;
}

/** Все акты каталога (кроме исключённых) для вкладки: состояние загрузки, проблема, редакция, принятые изменения. */
export async function adminActRows(db: SystemDb): Promise<AdminActRow[]> {
  const pending = db
    .select({ actId: legalPendingChanges.actId, n: count().as("n") })
    .from(legalPendingChanges)
    .where(eq(legalPendingChanges.status, "pending"))
    .groupBy(legalPendingChanges.actId)
    .as("pending");
  return db
    .select({
      pravoId: legalActs.pravoId,
      title: legalActs.title,
      topic: legalActs.topic,
      hasText: legalActs.hasText,
      status: legalActs.status,
      loadState: legalActs.loadState,
      lastProblem: legalActs.lastProblem,
      repealedOn: legalActs.repealedOn,
      editionAt: legalActSnapshots.fetchedAt,
      cardCheckedAt: legalActs.cardCheckedAt,
      pending: sql<number>`coalesce(${pending.n}, 0)`.mapWith(Number),
    })
    .from(legalActs)
    .leftJoin(legalActSnapshots, eq(legalActSnapshots.id, legalActs.currentSnapshotId))
    .leftJoin(pending, eq(pending.actId, legalActs.id))
    .where(ne(legalActs.status, "excluded"))
    .orderBy(legalActs.title);
}

export interface UpdateLogRow {
  readonly at: Date;
  readonly event: string;
  readonly pravoId: string | null;
  readonly title: string | null;
  readonly details: unknown;
}

/** Последние строки журнала обновлений: новые первыми. */
export async function updateLogRows(db: SystemDb, limit: number): Promise<UpdateLogRow[]> {
  return db
    .select({
      at: legalUpdateLog.at,
      event: legalUpdateLog.event,
      pravoId: legalActs.pravoId,
      title: legalActs.title,
      details: legalUpdateLog.details,
    })
    .from(legalUpdateLog)
    .leftJoin(legalActs, eq(legalActs.id, legalUpdateLog.actId))
    .orderBy(desc(legalUpdateLog.at), desc(legalUpdateLog.id))
    .limit(limit);
}

/** Последняя запись об итоге ежедневной проверки (успех или остановка загрузчика). */
export async function lastCheckRow(db: SystemDb): Promise<UpdateLogRow | undefined> {
  const rows = await db
    .select({
      at: legalUpdateLog.at,
      event: legalUpdateLog.event,
      pravoId: sql<string | null>`null`,
      title: sql<string | null>`null`,
      details: legalUpdateLog.details,
    })
    .from(legalUpdateLog)
    .where(sql`${legalUpdateLog.event} in ('daily-check', 'daily-check-failed')`)
    .orderBy(desc(legalUpdateLog.at), desc(legalUpdateLog.id))
    .limit(1);
  return rows[0];
}

export interface FetchLogRow {
  readonly at: Date;
  readonly url: string;
  readonly httpStatus: number | null;
  readonly bytes: number | null;
  readonly ms: number | null;
  readonly outcome: string;
}

/** Журнал запросов загрузчика: адрес без параметров поиска, код ответа, размер, время. */
export async function fetchLogRows(db: SystemDb, limit: number): Promise<FetchLogRow[]> {
  return db
    .select({
      at: legalFetchLog.at,
      url: legalFetchLog.url,
      httpStatus: legalFetchLog.httpStatus,
      bytes: legalFetchLog.bytes,
      ms: legalFetchLog.ms,
      outcome: legalFetchLog.outcome,
    })
    .from(legalFetchLog)
    .orderBy(desc(legalFetchLog.at), desc(legalFetchLog.id))
    .limit(limit);
}

export interface QueuedCandidate {
  readonly id: string;
  readonly pravoId: string;
  readonly title: string | null;
  readonly kindLine: string | null;
  readonly source: CandidateSource;
  readonly reason: string | null;
  readonly hasText: boolean | null;
  readonly topic: string | null;
  readonly foundOn: string | null;
}

/** Очередь администратора (LAW-15, LAW-17): давние первыми. */
export async function queuedCandidates(db: SystemDb): Promise<QueuedCandidate[]> {
  const rows = await db
    .select({
      id: legalCandidates.id,
      pravoId: legalCandidates.pravoId,
      title: legalCandidates.title,
      kindLine: legalCandidates.kindLine,
      source: legalCandidates.source,
      reason: legalCandidates.reason,
      hasText: legalCandidates.hasText,
      topic: legalCandidates.topic,
      foundOn: legalCandidates.foundOn,
    })
    .from(legalCandidates)
    .where(eq(legalCandidates.status, "queued"))
    .orderBy(legalCandidates.createdAt, legalCandidates.id);
  return rows.map((r) => ({ ...r, source: r.source as CandidateSource }));
}

/** Решение по кандидату из очереди: только если он ещё в очереди (двойной щелчок не перетирает решение). Возвращает ID акта. */
export async function decideQueued(
  db: SystemDb,
  id: string,
  status: "added" | "rejected",
  at: Date,
): Promise<string | null> {
  const rows = await db
    .update(legalCandidates)
    .set({ status, reason: "admin", decidedAt: at })
    .where(and(eq(legalCandidates.id, id), eq(legalCandidates.status, "queued")))
    .returning({ pravoId: legalCandidates.pravoId });
  return rows[0]?.pravoId ?? null;
}

/** Исключить акт (LAW-40): не показывается, не ищется, не проверяется; тексты и версии остаются. */
export async function excludeAct(db: SystemDb, pravoId: string): Promise<boolean> {
  const rows = await db
    .update(legalActs)
    .set({ status: "excluded" })
    .where(and(eq(legalActs.pravoId, pravoId), ne(legalActs.status, "excluded")))
    .returning({ id: legalActs.id });
  return rows.length > 0;
}

/** Вернуть исключённый акт: статус «действует» или «утратил силу» по дате карточки. */
export async function restoreAct(db: SystemDb, pravoId: string): Promise<boolean> {
  const rows = await db
    .update(legalActs)
    .set({
      status: sql`case when ${legalActs.repealedOn} is null then 'active' else 'repealed' end`,
    })
    .where(and(eq(legalActs.pravoId, pravoId), eq(legalActs.status, "excluded")))
    .returning({ id: legalActs.id });
  return rows.length > 0;
}

/** Сколько кандидатов ждёт решения; кандидаты прошлых суток — для сводки. */
export async function queuedCount(db: SystemDb): Promise<number> {
  return (
    (
      await db
        .select({ n: count() })
        .from(legalCandidates)
        .where(eq(legalCandidates.status, "queued"))
    )[0]?.n ?? 0
  );
}
