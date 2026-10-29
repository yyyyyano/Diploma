// Запросы к transactions и transaction_revisions: первый аргумент — s: ScopedDb, у каждого обращения свой s.own
// (ADR-0006). Строки, которые меняет действие, читаем FOR UPDATE в порядке id — два одновременных действия над
// пересекающимися операциями идут по очереди и не блокируют друг друга крест-накрест.
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { InsertValue, Patch, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { transactionRevisions, transactions } from "./schema.ts";

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransaction = InsertValue<typeof transactions>;
export type RevisionRow = typeof transactionRevisions.$inferSelect;
export type NewRevision = InsertValue<typeof transactionRevisions>;

/** Фильтры списка (TXN-02): всё необязательно, условия складываются по «и». */
export interface ListFilter {
  readonly text?: string;
  /** Встроенные категории и свои, чьё название содержит текст поиска (поиск «по категории»). */
  readonly matchedCategoryCodes?: readonly string[];
  readonly matchedCategoryIds?: readonly string[];
  readonly from?: string;
  readonly to?: string;
  readonly accountId?: string;
  readonly categoryCode?: string;
  readonly categoryId?: string;
  readonly type?: string;
  readonly amountFromMinor?: number;
  readonly amountToMinor?: number;
  readonly source?: string;
}

function where(s: ScopedDb, f: ListFilter): SQL {
  const t = transactions;
  const conditions: (SQL | undefined)[] = [s.own(t)];
  if (f.text !== undefined && f.text !== "") {
    // Подстрока без учёта регистра: strpos, а не LIKE — «%» и «_» в тексте поиска не подстановочные знаки.
    const needle = sql`lower(${f.text})`;
    const hit = (column: SQL) => sql`strpos(lower(coalesce(${column}, '')), ${needle}) > 0`;
    conditions.push(
      or(
        hit(sql`${t.description}`),
        hit(sql`${t.merchantName}`),
        hit(sql`${t.note}`),
        f.matchedCategoryCodes?.length
          ? inArray(t.categoryCode, [...f.matchedCategoryCodes])
          : undefined,
        f.matchedCategoryIds?.length ? inArray(t.categoryId, [...f.matchedCategoryIds]) : undefined,
      ),
    );
  }
  if (f.from !== undefined) conditions.push(gte(t.occurredOn, f.from));
  if (f.to !== undefined) conditions.push(lte(t.occurredOn, f.to));
  if (f.accountId !== undefined) conditions.push(eq(t.accountId, f.accountId));
  if (f.categoryCode !== undefined) conditions.push(eq(t.categoryCode, f.categoryCode));
  if (f.categoryId !== undefined) conditions.push(eq(t.categoryId, f.categoryId));
  if (f.type !== undefined) conditions.push(eq(t.type, f.type));
  if (f.amountFromMinor !== undefined) conditions.push(gte(t.amountBynMinor, f.amountFromMinor));
  if (f.amountToMinor !== undefined) conditions.push(lte(t.amountBynMinor, f.amountToMinor));
  if (f.source !== undefined) conditions.push(eq(t.source, f.source));
  return and(...conditions) ?? s.own(t);
}

/**
 * TXN-02: страница операций — новые сверху (день, время, затем id: устойчиво) — и сколько их всего под фильтром.
 * Время без значения (операция из выписки) — в конце дня.
 */
export async function listPage(
  s: ScopedDb,
  filter: ListFilter,
  page: number,
  pageSize: number,
): Promise<{ rows: TransactionRow[]; total: number }> {
  const condition = where(s, filter);
  const [rows, counted] = await Promise.all([
    s.db
      .select()
      .from(transactions)
      .where(condition)
      .orderBy(
        desc(transactions.occurredOn),
        sql`${transactions.occurredTime} desc nulls last`,
        desc(transactions.id),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    s.db
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(condition),
  ]);
  return { rows, total: counted[0]?.total ?? 0 };
}

/** Операции по id (свои); чужие и неизвестные просто не вернутся. */
export async function findMany(s: ScopedDb, ids: readonly string[]): Promise<TransactionRow[]> {
  if (ids.length === 0) return [];
  return s.db
    .select()
    .from(transactions)
    .where(and(s.own(transactions), inArray(transactions.id, [...ids])));
}

/** Те же операции под блокировкой строк, по возрастанию id. */
export async function lockMany(s: ScopedDb, ids: readonly string[]): Promise<TransactionRow[]> {
  if (ids.length === 0) return [];
  return s.db
    .select()
    .from(transactions)
    .where(and(s.own(transactions), inArray(transactions.id, [...ids])))
    .orderBy(asc(transactions.id))
    .for("update");
}

export async function insertTransaction(
  s: ScopedDb,
  value: NewTransaction,
): Promise<TransactionRow> {
  const rows = await s.insert(transactions).values(value).returning();
  const row = rows[0];
  if (row === undefined) throw new Error("transactions: вставка не вернула строку.");
  return row;
}

export async function updateTransaction(
  s: ScopedDb,
  id: string,
  patch: Patch<typeof transactions>,
): Promise<void> {
  await s.update(transactions, eq(transactions.id, id)).set(patch);
}

export async function deleteTransactions(s: ScopedDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await s.delete(transactions, inArray(transactions.id, [...ids]));
}

/** Какие из id существуют (свои) — пара перевода и покупка возврата при восстановлении удалённой. */
export async function existingIds(s: ScopedDb, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await s.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(s.own(transactions), inArray(transactions.id, [...ids])));
  return new Set(rows.map((row) => row.id));
}

/** CAT-05: операции с тем же контрагентом (ключ очистки) — кандидаты на «применить к прошлым». */
export async function listByMerchantKey(
  s: ScopedDb,
  merchantKey: string,
): Promise<TransactionRow[]> {
  return s.db
    .select()
    .from(transactions)
    .where(and(s.own(transactions), eq(transactions.merchantKey, merchantKey)))
    .orderBy(asc(transactions.id));
}

export async function insertRevisions(s: ScopedDb, rows: readonly NewRevision[]): Promise<void> {
  if (rows.length === 0) return;
  await s.insert(transactionRevisions).values([...rows]);
}

/** История одной операции (TXN-05): по времени, затем id. */
export async function listRevisions(s: ScopedDb, transactionId: string): Promise<RevisionRow[]> {
  return s.db
    .select()
    .from(transactionRevisions)
    .where(and(s.own(transactionRevisions), eq(transactionRevisions.transactionId, transactionId)))
    .orderBy(asc(transactionRevisions.createdAt), asc(transactionRevisions.id));
}

/** Ревизии пачки одного действия — материал «Отменить». */
export async function listBatch(s: ScopedDb, batchId: string): Promise<RevisionRow[]> {
  return s.db
    .select()
    .from(transactionRevisions)
    .where(and(s.own(transactionRevisions), eq(transactionRevisions.batchId, batchId)))
    .orderBy(asc(transactionRevisions.transactionId), asc(transactionRevisions.id));
}
