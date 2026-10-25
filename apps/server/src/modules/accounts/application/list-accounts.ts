// Список счетов домохозяйства (STMT-01): DTO контракта — без household_id и служебных полей. Остаток до операций —
// начальный остаток; пересчёт по операциям и дата остатка (STMT-02) — T-019.
import type { AccountListItem } from "@kosht/contract";
import { AccountId, AccountKind } from "@kosht/contract";
import { Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { listAccounts, type AccountRow } from "../infrastructure/db/accounts.repo.ts";

function toDto(row: AccountRow): AccountListItem {
  return {
    id: AccountId.parse(row.id),
    kind: AccountKind.parse(row.kind),
    name: row.name,
    balance: Money.of(row.initialBalanceMinor, row.currency),
  };
}

export async function listAccountItems(s: ScopedDb): Promise<{ items: AccountListItem[] }> {
  return { items: (await listAccounts(s)).map(toDto) };
}
