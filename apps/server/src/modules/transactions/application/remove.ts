// Удаление операций (TXN-03, AGT-07, P5): только через ожидающее решение «Да/Нет» в actions — одну операцию или
// пачку (массовое удаление T-022 — тот же обработчик). «Да» исполняет код: операции удаляются, остатки счетов
// сдвигаются, ревизии с состоянием «до» остаются — по ним «Отменить» сразу после «Да» возвращает удалённое.
import { formatMoney } from "@kosht/i18n";
import { Money } from "@kosht/kernel";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  deleteTransactions,
  findMany,
  lockMany,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import type { Deps, Parts } from "./deps.ts";
import { RESTORE_HANDLER } from "./write.ts";

export const DELETE_HANDLER = "transactions.delete";

const DeletePayload = z.object({
  ids: z.array(z.uuid()).min(1),
  channel: z.enum(["web", "telegram"]),
});

/** Сколько операций называется в вопросе поимённо. */
const EXAMPLES = 3;

function label(row: TransactionRow): string {
  const name = row.merchantName ?? (row.description === "" ? "—" : row.description);
  return `${name} ${formatMoney(Money.of(row.amountMinor, row.currency))}`;
}

export function makeRemove(d: Deps, parts: Parts) {
  /** AGT-07: вопрос «Удалить N операций?» — ожидающее решение; чужие и неизвестные id — NOT_FOUND. */
  async function requestDelete(
    s: ScopedDb,
    ids: readonly string[],
    channel: "web" | "telegram",
  ): Promise<string> {
    const unique = [...new Set(ids)];
    const rows = await findMany(s, unique);
    if (rows.length !== unique.length) throw new AppError("NOT_FOUND");
    const examples = [...rows]
      .sort((a, b) => (a.occurredOn === b.occurredOn ? 0 : a.occurredOn < b.occurredOn ? 1 : -1))
      .slice(0, EXAMPLES)
      .map(label)
      .join("; ");
    return d.actions.propose(s, {
      handler: DELETE_HANDLER,
      payload: { ids: unique, channel },
      summary: { key: "decisions.transactionsDelete", params: { count: rows.length, examples } },
    });
  }

  /** «Да» (реестр confirm): удалить; уже удалённых нет — ничего. Возвращает undoToken «Отменить» сразу после. */
  async function confirmDelete(tx: ScopedDb, payload: unknown): Promise<string | undefined> {
    const { ids, channel } = DeletePayload.parse(payload);
    const rows = await lockMany(tx, ids);
    if (rows.length === 0) return undefined;
    const batchId = randomUUID();
    await deleteTransactions(
      tx,
      rows.map((row) => row.id),
    );
    await parts.ledger.settle(tx, {
      batchId,
      channel,
      changes: rows.map((before) => ({ before })),
    });
    const [only] = rows;
    d.platform.log.info({ count: rows.length, batchId }, "transactions.deleted");
    return d.actions.record(tx, {
      handler: RESTORE_HANDLER,
      payload: { batchId },
      subject:
        rows.length === 1 && only !== undefined
          ? `transaction:${only.id}`
          : `transactions:${batchId}`,
      channel,
    });
  }

  return { requestDelete, confirmDelete };
}
