// Учёт изменений операций (TXN-05, STMT-02): одно действие — пачка изменений. Здесь общее для создания, правки,
// удаления и «Отменить»: ревизии (история и материал «Отменить»), сдвиг остатков счетов через фасад accounts,
// событие transactions.changed и сигнал сайту. Всё — в транзакции действия: откат убирает и остаток, и историю.
import { LocalDate, Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import {
  balanceDeltas,
  changedFields,
  type Direction,
  type Movement,
} from "../domain/transactions.ts";
import { transactionsChanged } from "../events.ts";
import {
  insertRevisions,
  type NewRevision,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import { snapshotOf, stateOf } from "./mapping.ts";

export type RevisionChannel = "web" | "telegram" | "system";

/** Одно изменение: было → стало (нет «до» — создана, нет «после» — удалена). */
export interface Change {
  readonly before?: TransactionRow;
  readonly after?: TransactionRow;
}

export interface Settle {
  readonly batchId: string;
  readonly channel: RevisionChannel;
  /** «Отменить»: создание и правка пишутся как «восстановлено». */
  readonly restoring?: boolean;
  readonly changes: readonly Change[];
}

export interface LedgerDeps {
  readonly platform: Pick<Platform, "events" | "realtime">;
  readonly accounts: Pick<AccountsFacade, "applyBalanceChange">;
}

function movement(row: TransactionRow): Movement {
  return {
    accountId: row.accountId,
    amount: Money.of(row.amountMinor, row.currency),
    direction: row.direction as Direction,
  };
}

export function makeLedger(d: LedgerDeps) {
  /** STMT-02: остатки счетов сдвигаются на разницу «после − до»; день остатка — самый поздний из затронутых. */
  async function shiftBalances(tx: ScopedDb, changes: readonly Change[]): Promise<void> {
    const deltas = balanceDeltas(
      changes.flatMap((c) => (c.before === undefined ? [] : [movement(c.before)])),
      changes.flatMap((c) => (c.after === undefined ? [] : [movement(c.after)])),
    );
    const days = new Map<string, string>();
    for (const change of changes) {
      for (const row of [change.before, change.after]) {
        if (row === undefined) continue;
        const seen = days.get(row.accountId);
        if (seen === undefined || row.occurredOn > seen) days.set(row.accountId, row.occurredOn);
      }
    }
    // Счета блокируются в одном порядке — два действия над общими счетами не ждут друг друга крест-накрест.
    for (const accountId of [...deltas.keys()].sort()) {
      const delta = deltas.get(accountId);
      const day = days.get(accountId);
      if (delta === undefined || day === undefined) continue;
      await d.accounts.applyBalanceChange(tx, { accountId, delta, on: LocalDate.parse(day) });
    }
  }

  async function settle(tx: ScopedDb, input: Settle): Promise<void> {
    const revisions: NewRevision[] = input.changes.map((change) => {
      const row = change.after ?? change.before;
      if (row === undefined) throw new Error("transactions: изменение без «до» и «после».");
      const created = change.before === undefined;
      const deleted = change.after === undefined;
      const action = deleted
        ? ("deleted" as const)
        : created
          ? input.restoring === true
            ? ("restored" as const)
            : ("created" as const)
          : input.restoring === true
            ? ("restored" as const)
            : ("updated" as const);
      return {
        transactionId: row.id,
        batchId: input.batchId,
        action,
        channel: input.channel,
        before: change.before === undefined ? null : stateOf(change.before),
        versionAfter: change.after?.version ?? null,
        fields:
          change.before !== undefined && change.after !== undefined
            ? changedFields(snapshotOf(change.before), snapshotOf(change.after))
            : [],
      };
    });
    await insertRevisions(tx, revisions);
    await shiftBalances(tx, input.changes);
    const ids = [...new Set(revisions.map((revision) => revision.transactionId))];
    await d.platform.events.publish(tx, transactionsChanged, { ids });
    await d.platform.realtime.changed(tx, { entity: "transaction", ids });
  }

  return { settle };
}

export type Ledger = ReturnType<typeof makeLedger>;
