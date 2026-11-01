// Запросы к receipts, receipt_items, receipt_attempts: первый аргумент — s: ScopedDb, у каждого обращения к таблице
// свой s.own (ADR-0006). Сценарии зовут эти функции, а не пишут SQL.
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { InsertValue, Patch, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { WarrantyItem } from "../../domain/warranty.ts";
import { receiptAttempts, receiptItems, receipts } from "./schema.ts";

export type ReceiptRow = typeof receipts.$inferSelect;
export type NewReceipt = InsertValue<typeof receipts>;
export type ReceiptPatch = Patch<typeof receipts>;
export type ItemRow = typeof receiptItems.$inferSelect;
export type NewItem = Omit<InsertValue<typeof receiptItems>, "receiptId">;
export type AttemptRow = typeof receiptAttempts.$inferSelect;
export type NewAttempt = Omit<InsertValue<typeof receiptAttempts>, "receiptId">;

export async function insertReceipt(s: ScopedDb, value: NewReceipt): Promise<ReceiptRow> {
  const rows = await s.insert(receipts).values(value).returning();
  // INSERT … RETURNING всегда возвращает вставленную строку.
  return rows[0] as ReceiptRow;
}

/** Чек по id (свой); чужой и неизвестный — undefined. */
export async function findReceipt(s: ScopedDb, id: string): Promise<ReceiptRow | undefined> {
  const rows = await s.db
    .select()
    .from(receipts)
    .where(and(s.own(receipts), eq(receipts.id, id)));
  return rows[0];
}

export async function updateReceipt(s: ScopedDb, id: string, patch: ReceiptPatch): Promise<void> {
  await s.update(receipts, eq(receipts.id, id)).set(patch);
}

/** RCPT-04: уже сохранённый чек с тем же УИ (кроме самого `exceptId`) — дубль. */
export async function findByUid(
  s: ScopedDb,
  uid: string,
  exceptId: string,
): Promise<ReceiptRow | undefined> {
  const rows = await s.db
    .select()
    .from(receipts)
    .where(and(s.own(receipts), eq(receipts.uid, uid), ne(receipts.id, exceptId)))
    .limit(1);
  return rows[0];
}

export interface DedupeKey {
  readonly storeKey: string;
  readonly date: string;
  readonly time: string;
  readonly totalMinor: number;
}

/**
 * RCPT-04: без QR дубль — тот же магазин, день, время и итог. Не дубль и не распознающийся чек: «не вышло» (в том числе
 * сам дубль) оригиналом не считается.
 */
export async function findByKey(
  s: ScopedDb,
  key: DedupeKey,
  exceptId: string,
): Promise<ReceiptRow | undefined> {
  const rows = await s.db
    .select()
    .from(receipts)
    .where(
      and(
        s.own(receipts),
        ne(receipts.id, exceptId),
        isNotNull(receipts.storeKey),
        eq(receipts.storeKey, key.storeKey),
        eq(receipts.purchaseDate, key.date),
        eq(receipts.purchaseTime, key.time),
        eq(receipts.totalMinor, key.totalMinor),
        ne(receipts.status, "failed"),
        ne(receipts.status, "processing"),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Позиции чека заменяются целиком: перепроверка и правка пересобирают их по номерам строк. */
export async function replaceItems(
  s: ScopedDb,
  receiptId: string,
  items: readonly NewItem[],
): Promise<void> {
  await s.delete(receiptItems, eq(receiptItems.receiptId, receiptId));
  if (items.length === 0) return;
  await s.insert(receiptItems).values(items.map((item) => ({ ...item, receiptId })));
}

export async function listItems(s: ScopedDb, receiptId: string): Promise<ItemRow[]> {
  return s.db
    .select()
    .from(receiptItems)
    .where(and(s.own(receiptItems), eq(receiptItems.receiptId, receiptId)))
    .orderBy(asc(receiptItems.position));
}

export async function insertAttempt(
  s: ScopedDb,
  receiptId: string,
  value: NewAttempt,
): Promise<void> {
  await s.insert(receiptAttempts).values({ ...value, receiptId });
}

export async function listAttempts(s: ScopedDb, receiptId: string): Promise<AttemptRow[]> {
  return s.db
    .select()
    .from(receiptAttempts)
    .where(and(s.own(receiptAttempts), eq(receiptAttempts.receiptId, receiptId)))
    .orderBy(asc(receiptAttempts.attempt));
}

/** Тот же чек под блокировкой строки: два запуска распознавания одного чека идут по очереди. */
export async function lockReceipt(s: ScopedDb, id: string): Promise<ReceiptRow | undefined> {
  const rows = await s.db
    .select()
    .from(receipts)
    .where(and(s.own(receipts), eq(receipts.id, id)))
    .for("update");
  return rows[0];
}

/** Нарушение уникального индекса (код PostgreSQL 23505): драйвер кладёт код в саму ошибку или в её причину. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Вкладка чеков: новые сверху, не больше `limit`. */
export async function listReceipts(s: ScopedDb, limit: number): Promise<ReceiptRow[]> {
  return s.db
    .select()
    .from(receipts)
    .where(s.own(receipts))
    .orderBy(desc(receipts.createdAt), desc(receipts.id))
    .limit(limit);
}

/** Чеки по id (свои): прежние чеки для «уже загружен 12.10». */
export async function findReceipts(s: ScopedDb, ids: readonly string[]): Promise<ReceiptRow[]> {
  if (ids.length === 0) return [];
  return s.db
    .select()
    .from(receipts)
    .where(and(s.own(receipts), inArray(receipts.id, [...ids])));
}

/** Чек удаляется вместе с позициями и историей (каскад по составному FK). */
export async function deleteReceipt(s: ScopedDb, id: string): Promise<void> {
  await s.delete(receipts, eq(receipts.id, id));
}

/**
 * Позиции с признаком гарантии в чеках `receiptIds` (пусто — во всех чеках пользователя) с магазином и днём покупки; «не
 * распознан» (`failed`) не берётся. Чужие и неизвестные чеки не видны: у обеих таблиц свой s.own.
 */
export async function warrantyItemsOf(
  s: ScopedDb,
  receiptIds: readonly string[],
): Promise<WarrantyItem[]> {
  return s.db
    .select({
      itemId: receiptItems.id,
      receiptId: receiptItems.receiptId,
      name: receiptItems.name,
      store: receipts.storeName,
      purchasedOn: receipts.purchaseDate,
    })
    .from(receiptItems)
    .innerJoin(
      receipts,
      and(
        eq(receipts.id, receiptItems.receiptId),
        eq(receipts.householdId, receiptItems.householdId),
        s.own(receipts),
      ),
    )
    .where(
      and(
        s.own(receiptItems),
        eq(receiptItems.warranty, true),
        ne(receipts.status, "failed"),
        receiptIds.length === 0 ? undefined : inArray(receiptItems.receiptId, [...receiptIds]),
      ),
    )
    .orderBy(asc(receipts.purchaseDate), asc(receiptItems.receiptId), asc(receiptItems.position));
}
