// Запросы к accounts: первый аргумент — s: ScopedDb, у каждого обращения свой s.own(accounts) (ADR-0006).
import { asc, desc, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { accounts } from "./schema.ts";

export interface AccountRow {
  readonly id: string;
  readonly kind: string;
  readonly name: string | null;
  readonly currency: string;
  readonly initialBalanceMinor: number;
}

/**
 * «Наличные» пользователя scope, если их ещё нет (STMT-01): вставка с ON CONFLICT DO NOTHING по уникальному индексу
 * наличных — повтор и параллельная доставка ничего не создают. Возвращает id созданного счёта или пусто.
 */
export async function createCashIfMissing(s: ScopedDb): Promise<string[]> {
  const rows = await s
    .insert(accounts)
    .values({ kind: "cash" })
    .onConflictDoNothing({
      target: [accounts.householdId, accounts.userId],
      where: sql`${accounts.kind} = 'cash'`,
    })
    .returning({ id: accounts.id });
  return rows.map((row) => row.id);
}

/** Счета домохозяйства: «Наличные» первыми, затем по времени создания; последний ключ — id (устойчиво). */
export async function listAccounts(s: ScopedDb): Promise<AccountRow[]> {
  return s.db
    .select({
      id: accounts.id,
      kind: accounts.kind,
      name: accounts.name,
      currency: accounts.currency,
      initialBalanceMinor: accounts.initialBalanceMinor,
    })
    .from(accounts)
    .where(s.own(accounts))
    .orderBy(desc(sql`${accounts.kind} = 'cash'`), asc(accounts.createdAt), asc(accounts.id));
}
