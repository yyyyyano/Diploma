// Агрегаты операций (FIN-01, RCPT-09): два запроса на любое число групп — суммы по группам и число операций без курса.
// Операция с разбивкой (`transaction_splits`) идёт по частям: часть = доля эквивалента в BYN по накопленной сумме разбивки,
// поэтому сумма частей равна сумме операции до копейки (в BYN — ровно суммы разбивки). Слитая «чек + выписка»
// операция одна и считается один раз; число операций группы и её основания — по операциям, а не по частям. Части
// берутся только у операций периода. Переводы не входят; `pending` входит (в остатки — нет, это дело accounts).
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { transactions, transactionSplits } from "./schema.ts";

export type GroupBy = "category" | "month" | "counterparty";
export type Kind = "expense" | "income" | "refund";

export interface GroupRow {
  readonly key: string;
  readonly kind: Kind;
  readonly minor: number;
  readonly count: number;
  readonly ids: readonly string[];
}

const KEY: Record<GroupBy, SQL> = {
  category: sql`case when category_code is not null then 'system:' || category_code else 'custom:' || category_id::text end`,
  month: sql`to_char(occurred_on, 'YYYY-MM')`,
  counterparty: sql`coalesce(merchant_key, '')`,
};

export interface AggregateQuery {
  readonly from: string;
  readonly to: string;
  readonly groupBy: GroupBy;
  /** Сколько id операций-оснований вернуть на группу. */
  readonly maxRefs: number;
}

export async function groupSums(s: ScopedDb, q: AggregateQuery): Promise<GroupRow[]> {
  const limit = sql.raw(String(Math.max(1, Math.trunc(q.maxRefs))));
  const result = await s.db.execute<{
    key: string;
    kind: Kind;
    minor: string;
    count: number;
    ids: string[];
  }>(sql`
    with ops as (
      select id, type, occurred_on, merchant_key, category_code, category_id, amount_minor, amount_byn_minor
      from ${transactions}
      where ${s.own(transactions)}
        and type in ('expense', 'income', 'refund')
        and occurred_on between ${q.from} and ${q.to}
        and amount_byn_minor is not null
    ),
    sp as (
      select transaction_id, category_code, category_id,
        sum(amount_minor) over (partition by transaction_id order by position) as cum,
        coalesce(sum(amount_minor) over (partition by transaction_id order by position
          rows between unbounded preceding and 1 preceding), 0) as prev
      from ${transactionSplits}
      where ${s.own(transactionSplits)}
        and transaction_id in (select id from ops)
    ),
    parts as (
      select id, type, occurred_on, merchant_key, category_code, category_id, amount_byn_minor as byn
      from ops
      where not exists (select 1 from sp where sp.transaction_id = ops.id)
      union all
      select ops.id, ops.type, ops.occurred_on, ops.merchant_key, sp.category_code, sp.category_id,
        floor(ops.amount_byn_minor::numeric * sp.cum / ops.amount_minor)
          - floor(ops.amount_byn_minor::numeric * sp.prev / ops.amount_minor)
      from ops join sp on sp.transaction_id = ops.id
    )
    -- Операция с разбивкой — несколько частей одной группы: в число операций и в основания она входит один раз.
    select key, kind, sum(byn)::bigint::text as minor, count(*)::int as count,
      (array_agg(id order by first_on, id))[1:${limit}] as ids
    from (
      select ${KEY[q.groupBy]} as key, type as kind, id, min(occurred_on) as first_on, sum(byn) as byn
      from parts
      group by 1, 2, id
    ) per_operation
    group by key, kind
    order by key, kind
  `);
  return result.rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    minor: Number(row.minor),
    count: row.count,
    ids: row.ids,
  }));
}

/** Операции периода без эквивалента в BYN (нет курса НБРБ): в сумму не входят, ответ называет их число. */
export async function countWithoutRate(
  s: ScopedDb,
  period: { from: string; to: string },
): Promise<number> {
  const rows = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        s.own(transactions),
        inArray(transactions.type, ["expense", "income", "refund"]),
        gte(transactions.occurredOn, period.from),
        lte(transactions.occurredOn, period.to),
        isNull(transactions.amountBynMinor),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** День первой операции (для «по данным за N мес.»); операций нет — `undefined`. */
export async function firstOperationOn(s: ScopedDb): Promise<string | undefined> {
  const rows = await s.db
    .select({ on: sql<string>`min(${transactions.occurredOn})::text` })
    .from(transactions)
    .where(and(s.own(transactions), eq(transactions.pending, false)));
  return rows[0]?.on ?? undefined;
}
