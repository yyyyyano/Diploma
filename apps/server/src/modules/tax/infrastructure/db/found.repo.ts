// Запросы найденных вычетов (TAX-20): первый аргумент — s: ScopedDb, у каждого обращения свой s.own (ADR-0006).
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { InsertValue, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { foundDeductions } from "./schema.ts";

export type FoundRow = typeof foundDeductions.$inferSelect;
export type NewFound = InsertValue<typeof foundDeductions>;

/** Все найденные вычеты пользователя: активные сверху (новые, показанные), свежие первыми. */
export async function listFound(s: ScopedDb): Promise<FoundRow[]> {
  return s.db
    .select()
    .from(foundDeductions)
    .where(s.own(foundDeductions))
    .orderBy(
      desc(foundDeductions.foundOn),
      asc(foundDeductions.createdAt),
      asc(foundDeductions.id),
    );
}

export async function findFound(s: ScopedDb, id: string): Promise<FoundRow | undefined> {
  const rows = await s.db
    .select()
    .from(foundDeductions)
    .where(and(s.own(foundDeductions), eq(foundDeductions.id, id)))
    .for("update");
  return rows[0];
}

/** Основание уже записано? Повтор события дубль не создаёт; id новой записи — только если вставлена именно эта. */
export async function insertFound(s: ScopedDb, row: NewFound): Promise<string | undefined> {
  const rows = await s
    .insert(foundDeductions)
    .values(row)
    .onConflictDoNothing({
      target: [
        foundDeductions.householdId,
        foundDeductions.userId,
        foundDeductions.kind,
        foundDeductions.basisKey,
      ],
    })
    .returning({ id: foundDeductions.id });
  return rows[0]?.id;
}

export async function setStatus(s: ScopedDb, id: string, status: string): Promise<void> {
  await s.db
    .update(foundDeductions)
    .set({ status })
    .where(and(s.own(foundDeductions), eq(foundDeductions.id, id)));
}

/** «Показан»: только новые (не трогает отклонённые и оформленные). */
export async function markShown(s: ScopedDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await s.db
    .update(foundDeductions)
    .set({ status: "shown" })
    .where(
      and(
        s.own(foundDeductions),
        inArray(foundDeductions.id, [...ids]),
        eq(foundDeductions.status, "new"),
      ),
    );
}

/** Обновить сумму и расчёт активной записи (новый, показанный): калькулятор мог дать другое число после правки профиля. */
export async function refreshAmount(
  s: ScopedDb,
  id: string,
  amountMinor: number | null,
  traceId: string | null,
): Promise<void> {
  await s.db
    .update(foundDeductions)
    .set({ amountMinor, traceId })
    .where(
      and(
        s.own(foundDeductions),
        eq(foundDeductions.id, id),
        inArray(foundDeductions.status, ["new", "shown"]),
      ),
    );
}

/** Жильё: вопрос об учёте нуждающихся стал находкой (или наоборот) — меняется только причина активной записи. */
export async function setReason(s: ScopedDb, id: string, reason: string): Promise<void> {
  await s.db
    .update(foundDeductions)
    .set({ reason })
    .where(and(s.own(foundDeductions), eq(foundDeductions.id, id)));
}

export async function removeActive(s: ScopedDb, kind: string, basisKey: string): Promise<void> {
  await s.db
    .delete(foundDeductions)
    .where(
      and(
        s.own(foundDeductions),
        eq(foundDeductions.kind, kind),
        eq(foundDeductions.basisKey, basisKey),
        inArray(foundDeductions.status, ["new", "shown"]),
      ),
    );
}

export async function findByBasis(
  s: ScopedDb,
  kind: string,
  basisKey: string,
): Promise<FoundRow | undefined> {
  const rows = await s.db
    .select()
    .from(foundDeductions)
    .where(
      and(
        s.own(foundDeductions),
        eq(foundDeductions.kind, kind),
        eq(foundDeductions.basisKey, basisKey),
      ),
    );
  return rows[0];
}
