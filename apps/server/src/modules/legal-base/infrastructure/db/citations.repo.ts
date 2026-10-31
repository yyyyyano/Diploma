// Чтение для цитат legal-consult (LEGAL-03, LEGAL-05, LEGAL-08, CHAT-10): версия фрагмента по id — любая, не только действующая
// (ответ ссылается на версию), с днём редакции и состоянием акта; день первой редакции в базе. Только SystemDb, только чтение.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { legalActSnapshots, legalActs, legalFragmentVersions, legalFragments } from "./schema.ts";

export interface CitationRow {
  readonly versionId: string;
  readonly pravoId: string;
  readonly actTitle: string;
  readonly pathKey: string;
  readonly articleNo: string | null;
  /** Путь для человека: «НК (Особенная часть) › Глава 16 › Статья 209 › п. 1». */
  readonly path: string;
  readonly text: string;
  readonly excluded: boolean;
  /** Действующая ли это версия: нет — текст с тех пор изменился (CHAT-10). */
  readonly isCurrent: boolean;
  /** `excluded` — администратор исключил акт: ни цитировать, ни называть нельзя. */
  readonly actStatus: "active" | "repealed" | "excluded";
  readonly repealedOn: string | null;
  readonly hasText: boolean;
  /** День редакции: у действующей версии — снимок действующей редакции акта, у прежней — последний снимок, где она ещё была. */
  readonly editionAt: Date | null;
}

/** Версии фрагментов по id (порядок — как в списке); неизвестный id пропускается. */
export async function citationRows(
  db: SystemDb,
  ids: readonly string[],
): Promise<readonly CitationRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      versionId: legalFragmentVersions.id,
      pravoId: legalActs.pravoId,
      actTitle: legalActs.title,
      pathKey: legalFragments.pathKey,
      articleNo: legalFragments.articleNo,
      path: legalFragmentVersions.searchPath,
      text: legalFragmentVersions.body,
      excluded: legalFragmentVersions.excluded,
      isCurrent: legalFragmentVersions.isCurrent,
      actStatus: legalActs.status,
      repealedOn: legalActs.repealedOn,
      hasText: legalActs.hasText,
      currentSnapshotId: legalActs.currentSnapshotId,
      lastSnapshotId: legalFragmentVersions.lastSnapshotId,
    })
    .from(legalFragmentVersions)
    .innerJoin(legalFragments, eq(legalFragments.id, legalFragmentVersions.fragmentId))
    .innerJoin(legalActs, eq(legalActs.id, legalFragments.actId))
    .where(inArray(legalFragmentVersions.id, [...ids]));
  const snapshotIds = [
    ...new Set(
      rows.flatMap((r) => [r.currentSnapshotId, r.lastSnapshotId]).filter((x) => x !== null),
    ),
  ];
  const times = new Map(
    snapshotIds.length === 0
      ? []
      : (
          await db
            .select({ id: legalActSnapshots.id, at: legalActSnapshots.fetchedAt })
            .from(legalActSnapshots)
            .where(inArray(legalActSnapshots.id, snapshotIds))
        ).map((r) => [r.id, r.at]),
  );
  const byId = new Map(
    rows.map((r) => {
      const snapshotId = r.isCurrent ? r.currentSnapshotId : r.lastSnapshotId;
      const row: CitationRow = {
        versionId: r.versionId,
        pravoId: r.pravoId,
        actTitle: r.actTitle,
        pathKey: r.pathKey,
        articleNo: r.articleNo,
        path: r.path,
        text: r.text,
        excluded: r.excluded,
        isCurrent: r.isCurrent,
        actStatus:
          r.actStatus === "repealed" || r.actStatus === "excluded" ? r.actStatus : "active",
        repealedOn: r.repealedOn,
        hasText: r.hasText,
        editionAt: snapshotId === null ? null : (times.get(snapshotId) ?? null),
      };
      return [r.versionId, row] as const;
    }),
  );
  return ids.map((id) => byId.get(id)).filter((r): r is CitationRow => r !== undefined);
}

/** Время первого применённого снимка акта: раньше этого дня прежней редакции в базе нет (LEGAL-08). Нет снимков — null. */
export async function firstEditionAt(db: SystemDb, pravoId: string): Promise<Date | null> {
  const rows = await db
    .select({ at: legalActSnapshots.fetchedAt })
    .from(legalActSnapshots)
    .innerJoin(legalActs, eq(legalActs.id, legalActSnapshots.actId))
    .where(and(eq(legalActs.pravoId, pravoId), eq(legalActSnapshots.status, "applied")))
    .orderBy(asc(legalActSnapshots.fetchedAt))
    .limit(1);
  return rows[0]?.at ?? null;
}
