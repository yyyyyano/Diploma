// Запросы таблицы ставок (TAX-03, ADM-11, LAW-33) — через SystemDb модуля (подтверждение — в транзакции вызывающего): прежнее
// подтверждённое значение того же периода становится `superseded`, новое — `confirmed`; пересечение с другим периодом не пропускается.
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { normRates, type RateStatus } from "./schema.ts";

export type RateRecord = typeof normRates.$inferSelect;

/** Все версии значений, кроме отклонённых: по параметру, периоду и времени создания. */
export async function allRates(db: SystemDb): Promise<RateRecord[]> {
  return db
    .select()
    .from(normRates)
    .where(ne(normRates.status, "rejected"))
    .orderBy(asc(normRates.param), asc(normRates.validFrom), asc(normRates.createdAt));
}

export async function findRate(db: SystemDb, id: string): Promise<RateRecord | undefined> {
  return (await db.select().from(normRates).where(eq(normRates.id, id)))[0];
}

/** Подтверждённое значение параметра на день: действует `validFrom ≤ день ≤ validTo`; при нескольких — с самым поздним началом. */
export async function confirmedAt(
  db: SystemDb,
  param: string,
  day: string,
): Promise<RateRecord | undefined> {
  const rows = await db
    .select()
    .from(normRates)
    .where(
      and(
        eq(normRates.param, param),
        eq(normRates.status, "confirmed"),
        lte(normRates.validFrom, day),
        or(isNull(normRates.validTo), gte(normRates.validTo, day)),
      ),
    )
    .orderBy(desc(normRates.validFrom))
    .limit(1);
  return rows[0];
}

/** Ждёт ли подтверждения значение параметра на день: факт для ответа «значение есть, но не подтверждено». */
export async function pendingAt(db: SystemDb, param: string, day: string): Promise<boolean> {
  const rows = await db
    .select({ id: normRates.id })
    .from(normRates)
    .where(
      and(
        eq(normRates.param, param),
        eq(normRates.status, "pending"),
        lte(normRates.validFrom, day),
        or(isNull(normRates.validTo), gte(normRates.validTo, day)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface NewRate {
  readonly param: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly value: number;
  readonly sourceAct: string | null;
  readonly sourcePath: string | null;
  readonly sourceArticle: string | null;
  readonly sourcePoint: string | null;
  readonly sourceUrl: string | null;
}

/** Предложить значение: ожидающее на тот же параметр и начало периода правится на месте, а не плодит строки. */
export async function savePending(db: SystemDb, rate: NewRate): Promise<void> {
  const fields = {
    validTo: rate.validTo,
    value: rate.value,
    sourceAct: rate.sourceAct,
    sourcePath: rate.sourcePath,
    sourceArticle: rate.sourceArticle,
    sourcePoint: rate.sourcePoint,
    sourceUrl: rate.sourceUrl,
    sourceVersionId: null,
  };
  const updated = await db
    .update(normRates)
    .set(fields)
    .where(
      and(
        eq(normRates.param, rate.param),
        eq(normRates.validFrom, rate.validFrom),
        eq(normRates.status, "pending"),
      ),
    )
    .returning({ id: normRates.id });
  if (updated.length > 0) return;
  await db
    .insert(normRates)
    .values({ param: rate.param, validFrom: rate.validFrom, status: "pending", ...fields });
}

export type ConfirmResult = "confirmed" | "not-found" | "overlap";

/**
 * «Подтвердить»: ожидающее → подтверждённое, прежнее того же начала → вытеснено; пересечение с подтверждённым другого
 * периода — `overlap`. Транзакцию открывает вызывающий (`s.transaction`), чтобы событие
 * `norm-tables.values-confirmed` ушло в ней же: `tx` — `tx.db` ScopedDb (SystemDb подходит под этот тип).
 */
export async function confirmPending(
  tx: ScopedDb["db"],
  id: string,
  by: "developer" | "admin",
  on: string,
): Promise<{ result: ConfirmResult; row?: RateRecord }> {
  const row = (
    await tx
      .select()
      .from(normRates)
      .where(and(eq(normRates.id, id), eq(normRates.status, "pending")))
  )[0];
  if (row === undefined) return { result: "not-found" };
  const overlap = await tx
    .select({ id: normRates.id })
    .from(normRates)
    .where(
      and(
        eq(normRates.param, row.param),
        eq(normRates.status, "confirmed"),
        ne(normRates.validFrom, row.validFrom),
        or(isNull(normRates.validTo), gte(normRates.validTo, row.validFrom)),
        row.validTo === null ? undefined : lte(normRates.validFrom, row.validTo),
      ),
    )
    .limit(1);
  if (overlap.length > 0) return { result: "overlap" };
  await tx
    .update(normRates)
    .set({ status: "superseded" })
    .where(
      and(
        eq(normRates.param, row.param),
        eq(normRates.validFrom, row.validFrom),
        eq(normRates.status, "confirmed"),
      ),
    );
  const [confirmed] = await tx
    .update(normRates)
    .set({ status: "confirmed", confirmedByKind: by, confirmedOn: on, driftAt: null })
    .where(eq(normRates.id, id))
    .returning();
  return { result: "confirmed", ...(confirmed === undefined ? {} : { row: confirmed }) };
}

/** Отклонить ожидающее значение. */
export async function rejectPending(db: SystemDb, id: string): Promise<boolean> {
  const rows = await db
    .update(normRates)
    .set({ status: "rejected" satisfies RateStatus })
    .where(and(eq(normRates.id, id), eq(normRates.status, "pending")))
    .returning({ id: normRates.id });
  return rows.length > 0;
}

/**
 * Подтверждённые значения, у которых есть источник в тексте pravo.by и чей период включает `today` (сверка LAW-33): действующая
 * редакция нормы отвечает за сегодняшние числа, а не за прошлые годы и не за будущие.
 */
export async function checkableRates(db: SystemDb, today: string): Promise<RateRecord[]> {
  return db
    .select()
    .from(normRates)
    .where(
      and(
        eq(normRates.status, "confirmed"),
        isNotNull(normRates.sourceAct),
        isNotNull(normRates.sourcePath),
        lte(normRates.validFrom, today),
        or(isNull(normRates.validTo), gte(normRates.validTo, today)),
      ),
    )
    .orderBy(asc(normRates.param), asc(normRates.validFrom));
}

/** Пометка расхождения и ссылка на версию фрагмента: значение не меняется. */
export async function markCheck(
  db: SystemDb,
  id: string,
  patch: { driftAt: Date | null; sourceVersionId: string | null },
): Promise<void> {
  await db
    .update(normRates)
    .set({ driftAt: patch.driftAt, sourceVersionId: patch.sourceVersionId })
    .where(and(eq(normRates.id, id), eq(normRates.status, "confirmed")));
}
