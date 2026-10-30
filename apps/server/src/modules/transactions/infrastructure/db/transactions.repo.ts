// Запросы к transactions и transaction_revisions: первый аргумент — s: ScopedDb, у каждого обращения свой s.own
// (ADR-0006). Строки, которые меняет действие, читаем FOR UPDATE в порядке id — два одновременных действия над
// пересекающимися операциями идут по очереди и не блокируют друг друга крест-накрест.
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { InsertValue, Patch, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { transactionRevisions, transactionSplits, transactions } from "./schema.ts";

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransaction = InsertValue<typeof transactions>;
export type RevisionRow = typeof transactionRevisions.$inferSelect;
export type NewRevision = InsertValue<typeof transactionRevisions>;
export type SplitRow = typeof transactionSplits.$inferSelect;
export type NewSplit = Omit<InsertValue<typeof transactionSplits>, "transactionId">;

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
  readonly hasReceipt?: boolean;
  readonly needsReview?: boolean;
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
  if (f.hasReceipt !== undefined) {
    conditions.push(f.hasReceipt ? isNotNull(t.receiptId) : isNull(t.receiptId));
  }
  if (f.needsReview !== undefined) conditions.push(eq(t.needsReview, f.needsReview));
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

/** STMT-07: какие из ключей дубля уже есть у операций выписок. */
export async function existingDedupeKeys(
  s: ScopedDb,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await s.db
    .select({ key: transactions.dedupeKey })
    .from(transactions)
    .where(and(s.own(transactions), inArray(transactions.dedupeKey, [...keys])));
  // Ключ в условии IN — не null: строки без ключа в выборку не попадают.
  return new Set(rows.map((row) => String(row.key)));
}

/** STMT-07: какие банковские идентификаторы операций уже есть. */
export async function existingExternalIds(
  s: ScopedDb,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await s.db
    .select({ id: transactions.externalId })
    .from(transactions)
    .where(and(s.own(transactions), inArray(transactions.externalId, [...ids])));
  return new Set(rows.map((row) => String(row.id)));
}

/** STMT-08: переводы без пары на других счетах за окно — кандидаты в пару новому переводу. */
export async function unpairedTransfers(
  s: ScopedDb,
  filter: { from: string; to: string; excludeAccountIds: readonly string[] },
): Promise<TransactionRow[]> {
  const conditions = [
    s.own(transactions),
    eq(transactions.type, "transfer"),
    sql`${transactions.transferPairId} is null`,
    gte(transactions.occurredOn, filter.from),
    lte(transactions.occurredOn, filter.to),
  ];
  if (filter.excludeAccountIds.length > 0) {
    conditions.push(sql`${transactions.accountId} not in ${[...filter.excludeAccountIds]}`);
  }
  return s.db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(asc(transactions.occurredOn), asc(transactions.id));
}

/** STMT-08: расходы тех же контрагентов за окно — покупки, к которым может относиться возврат. */
export async function purchasesOf(
  s: ScopedDb,
  filter: { merchantKeys: readonly string[]; from: string; to: string },
): Promise<TransactionRow[]> {
  if (filter.merchantKeys.length === 0) return [];
  return s.db
    .select()
    .from(transactions)
    .where(
      and(
        s.own(transactions),
        eq(transactions.type, "expense"),
        inArray(transactions.merchantKey, [...filter.merchantKeys]),
        gte(transactions.occurredOn, filter.from),
        lte(transactions.occurredOn, filter.to),
      ),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.id));
}

/** STMT-11: операции одного импорта под блокировкой. */
export async function lockByImport(s: ScopedDb, importId: string): Promise<TransactionRow[]> {
  return s.db
    .select()
    .from(transactions)
    .where(and(s.own(transactions), eq(transactions.importId, importId)))
    .orderBy(asc(transactions.id))
    .for("update");
}

/** STMT-11: сколько операций импорта правили вручную после загрузки (версия выше первой). */
export async function countEditedInImport(s: ScopedDb, importId: string): Promise<number> {
  const rows = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(s.own(transactions), eq(transactions.importId, importId), gte(transactions.version, 2)),
    );
  // count(*) всегда возвращает ровно одну строку.
  return rows.reduce((total, row) => total + row.n, 0);
}

/** Операция от чека (RCPT-08, TXN-10): по id чека; нет — undefined. */
export async function findByReceipt(
  s: ScopedDb,
  receiptId: string,
): Promise<TransactionRow | undefined> {
  const rows = await s.db
    .select()
    .from(transactions)
    .where(and(s.own(transactions), eq(transactions.receiptId, receiptId)))
    .limit(1);
  return rows[0];
}

/** Разбивка операции по категориям (RCPT-09): заменяется целиком. */
export async function replaceSplits(
  s: ScopedDb,
  transactionId: string,
  splits: readonly NewSplit[],
): Promise<void> {
  await s.delete(transactionSplits, eq(transactionSplits.transactionId, transactionId));
  if (splits.length === 0) return;
  await s.insert(transactionSplits).values(splits.map((split) => ({ ...split, transactionId })));
}

export async function listSplits(s: ScopedDb, transactionId: string): Promise<SplitRow[]> {
  return s.db
    .select()
    .from(transactionSplits)
    .where(and(s.own(transactionSplits), eq(transactionSplits.transactionId, transactionId)))
    .orderBy(asc(transactionSplits.position));
}

export interface CandidateQuery {
  readonly amountMinor: number;
  readonly currency: string;
  readonly toleranceMinor: number;
  readonly from: string;
  readonly to: string;
}

/**
 * TXN-10: расходные операции выписки без чека с той же суммой (с допуском) в окне дат — кандидаты для чека. Предварительные
 * операции чеков сюда не попадают: у них источник «чек», а не «выписка».
 */
export async function bankCandidates(s: ScopedDb, q: CandidateQuery): Promise<TransactionRow[]> {
  const t = transactions;
  return s.db
    .select()
    .from(t)
    .where(
      and(
        s.own(t),
        eq(t.source, "statement"),
        eq(t.type, "expense"),
        isNull(t.receiptId),
        eq(t.currency, q.currency),
        gte(t.amountMinor, q.amountMinor - q.toleranceMinor),
        lte(t.amountMinor, q.amountMinor + q.toleranceMinor),
        gte(t.occurredOn, q.from),
        lte(t.occurredOn, q.to),
      ),
    )
    .orderBy(asc(t.occurredOn), asc(t.id));
}

/** TXN-10: операции от чеков (наличные и «ожидает выписки») с той же суммой в окне дат — кандидаты для платежа банка. */
export async function receiptCandidates(s: ScopedDb, q: CandidateQuery): Promise<TransactionRow[]> {
  const t = transactions;
  return s.db
    .select()
    .from(t)
    .where(
      and(
        s.own(t),
        eq(t.source, "receipt"),
        eq(t.type, "expense"),
        isNotNull(t.receiptId),
        eq(t.currency, q.currency),
        gte(t.amountMinor, q.amountMinor - q.toleranceMinor),
        lte(t.amountMinor, q.amountMinor + q.toleranceMinor),
        gte(t.occurredOn, q.from),
        lte(t.occurredOn, q.to),
      ),
    )
    .orderBy(asc(t.occurredOn), asc(t.id));
}

/** Операция для поиска регулярных (REC-01): только то, что нужно, без описания и заметок. */
export interface HistoryRow {
  readonly id: string;
  readonly merchantKey: string;
  readonly merchantName: string;
  readonly type: "expense" | "income";
  readonly occurredOn: string;
  readonly amountBynMinor: number;
  readonly categoryCode: string | null;
  readonly categoryId: string | null;
}

/**
 * REC-01: доходы и расходы с известным контрагентом за период — без переводов и возвратов, без «ожидает выписки» (она
 * придёт второй раз) и без курса НБРБ (эквивалента ещё нет). Ключи контрагентов — пачкой, не запросом на операцию.
 */
export async function recurringHistory(
  s: ScopedDb,
  input: { from: string; to: string; merchantKeys?: readonly string[] },
): Promise<HistoryRow[]> {
  const rows = await s.db
    .select({
      id: transactions.id,
      merchantKey: transactions.merchantKey,
      merchantName: transactions.merchantName,
      type: transactions.type,
      occurredOn: transactions.occurredOn,
      amountBynMinor: transactions.amountBynMinor,
      categoryCode: transactions.categoryCode,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(
      and(
        s.own(transactions),
        inArray(transactions.type, ["expense", "income"]),
        eq(transactions.pending, false),
        isNotNull(transactions.merchantKey),
        isNotNull(transactions.amountBynMinor),
        gte(transactions.occurredOn, input.from),
        lte(transactions.occurredOn, input.to),
        input.merchantKeys === undefined
          ? undefined
          : inArray(transactions.merchantKey, [...input.merchantKeys]),
      ),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.id));
  return rows.flatMap((row) =>
    row.merchantKey === null || row.amountBynMinor === null
      ? []
      : [
          {
            ...row,
            merchantKey: row.merchantKey,
            merchantName: row.merchantName ?? row.merchantKey,
            amountBynMinor: row.amountBynMinor,
            type: row.type as "expense" | "income",
          },
        ],
  );
}
