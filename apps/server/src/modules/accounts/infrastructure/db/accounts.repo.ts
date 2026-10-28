// Запросы к accounts и account_revisions: первый аргумент — s: ScopedDb, у каждого обращения свой s.own (ADR-0006).
// Строку, которую меняет действие, читаем FOR UPDATE: два одновременных изменения одного счёта идут по очереди.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { accountRevisions, accounts } from "./schema.ts";

export interface AccountRow {
  readonly id: string;
  readonly kind: string;
  readonly name: string | null;
  readonly bank: string | null;
  readonly mask: string | null;
  readonly currency: string;
  readonly initialBalanceMinor: number;
  readonly balanceMinor: number;
  readonly balanceOn: string;
  readonly balanceSource: string;
}

const columns = {
  id: accounts.id,
  kind: accounts.kind,
  name: accounts.name,
  bank: accounts.bank,
  mask: accounts.mask,
  currency: accounts.currency,
  initialBalanceMinor: accounts.initialBalanceMinor,
  balanceMinor: accounts.balanceMinor,
  balanceOn: accounts.balanceOn,
  balanceSource: accounts.balanceSource,
};

/**
 * «Наличные» в BYN пользователя scope, если их ещё нет (STMT-01): вставка с ON CONFLICT DO NOTHING по уникальному
 * индексу наличных — повтор и параллельная доставка ничего не создают. Возвращает id созданного счёта или пусто.
 */
export async function createCashIfMissing(s: ScopedDb, today: string): Promise<string[]> {
  const rows = await s
    .insert(accounts)
    .values({ kind: "cash", currency: "BYN", balanceOn: today })
    .onConflictDoNothing({
      target: [accounts.householdId, accounts.userId],
      where: sql`${accounts.kind} = 'cash' and ${accounts.currency} = 'BYN'`,
    })
    .returning({ id: accounts.id });
  return rows.map((row) => row.id);
}

/** «Карта, не указана» домохозяйства, если её ещё нет (RCPT-10): так же идемпотентно. */
export async function createUnknownCardIfMissing(s: ScopedDb, today: string): Promise<string[]> {
  const rows = await s
    .insert(accounts)
    .values({ kind: "unknown-card", currency: "BYN", balanceOn: today })
    .onConflictDoNothing({
      target: [accounts.householdId],
      where: sql`${accounts.kind} = 'unknown-card'`,
    })
    .returning({ id: accounts.id });
  return rows.map((row) => row.id);
}

/** Служебный счёт вида: «Наличные» в BYN пользователя или «Карта, не указана» домохозяйства. */
export async function findService(
  s: ScopedDb,
  kind: "cash" | "unknown-card",
): Promise<string | undefined> {
  const rows = await s.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      kind === "cash"
        ? and(
            s.own(accounts),
            eq(accounts.userId, s.scope.userId),
            eq(accounts.kind, "cash"),
            eq(accounts.currency, "BYN"),
          )
        : and(s.own(accounts), eq(accounts.kind, "unknown-card")),
    );
  return rows[0]?.id;
}

/** Счета домохозяйства: «Наличные» первыми, затем по времени создания; последний ключ — id (устойчиво). */
export async function listAccounts(s: ScopedDb): Promise<AccountRow[]> {
  return s.db
    .select(columns)
    .from(accounts)
    .where(s.own(accounts))
    .orderBy(
      desc(sql`${accounts.kind} = 'cash' and ${accounts.currency} = 'BYN'`),
      asc(accounts.createdAt),
      asc(accounts.id),
    );
}

/** Счёт по id под блокировкой строки; чужой и неизвестный — undefined. */
export async function lockAccount(s: ScopedDb, id: string): Promise<AccountRow | undefined> {
  const rows = await s.db
    .select(columns)
    .from(accounts)
    .where(and(s.own(accounts), eq(accounts.id, id)))
    .for("update");
  return rows[0];
}

/** Карта банка по маске и валюте (банк — без учёта регистра). */
export async function findByBankMask(
  s: ScopedDb,
  key: { bank: string; mask: string; currency: string },
): Promise<string | undefined> {
  const rows = await s.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        s.own(accounts),
        sql`lower(${accounts.bank}) = lower(${key.bank})`,
        eq(accounts.mask, key.mask),
        eq(accounts.currency, key.currency),
      ),
    );
  return rows[0]?.id;
}

export interface NewAccount {
  readonly kind: string;
  readonly name: string | null;
  readonly bank: string | null;
  readonly mask: string | null;
  readonly currency: string;
  readonly initialBalanceMinor: number;
  readonly balanceMinor: number;
  readonly balanceOn: string;
  readonly balanceSource: string;
}

/** Новый счёт; такой уже есть (тот же банк, маска и валюта или служебный) — undefined. */
export async function insertAccount(s: ScopedDb, account: NewAccount): Promise<string | undefined> {
  const rows = await s
    .insert(accounts)
    .values(account)
    .onConflictDoNothing()
    .returning({ id: accounts.id });
  return rows[0]?.id;
}

export async function updateAccount(
  s: ScopedDb,
  id: string,
  patch: Partial<NewAccount>,
  at: Date,
): Promise<void> {
  await s.update(accounts, eq(accounts.id, id)).set({ ...patch, updatedAt: at });
}

/** Удалить счёт; false — на него ссылаются операции (FK RESTRICT: 23001, NO ACTION: 23503) — счёт на месте. */
export async function deleteAccount(s: ScopedDb, id: string): Promise<boolean> {
  try {
    await s.delete(accounts, eq(accounts.id, id));
    return true;
  } catch (error) {
    if (isForeignKeyViolation(error)) return false;
    throw error;
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    const code = (cause as { code?: unknown }).code;
    if (code === "23001" || code === "23503") return true;
  }
  return false;
}

export interface Revision {
  readonly accountId: string;
  readonly existed: boolean;
  readonly name: string | null;
  readonly initialBalanceMinor: number;
}

export async function insertRevision(s: ScopedDb, revision: Revision): Promise<string> {
  const rows = await s
    .insert(accountRevisions)
    .values(revision)
    .returning({ id: accountRevisions.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("account_revisions: вставка не вернула id.");
  return id;
}

export async function findRevision(s: ScopedDb, id: string): Promise<Revision | undefined> {
  const rows = await s.db
    .select({
      accountId: accountRevisions.accountId,
      existed: accountRevisions.existed,
      name: accountRevisions.name,
      initialBalanceMinor: accountRevisions.initialBalanceMinor,
    })
    .from(accountRevisions)
    .where(and(s.own(accountRevisions), eq(accountRevisions.id, id)));
  return rows[0];
}
