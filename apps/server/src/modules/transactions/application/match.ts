// Сопоставление чека и выписки (TXN-10, TXN-11, RCPT-10, NOTIF-02, NOTIF-05): чтобы покупка не учитывалась дважды. Кандидат —
// расходная операция по карте с той же суммой (допуск), в окне дат, а «уверенный» ещё и с похожим магазином (один справочник
// контрагентов или похожие названия — порог в настройках). Единственный уверенный — связываем сами и сообщаем с кнопкой «Это
// разные покупки»; несколько или неуверенно — один раз спрашиваем «одна покупка?» (ожидающее решение в actions). После связи
// операция одна: сумма и день — из выписки, разбивка — из чека, трата со «Наличных» исчезает. Всё — в транзакции вместе с
// событием `transactions.merged`; снимок операции чека лежит в слитой операции, по нему работают «Это разные покупки», ручной
// разрыв и «Отменить». Поиск кандидатов и справочник — до транзакции (SystemDb, не в s.transaction).
import { allocate } from "@kosht/calc";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { transactionsMerged } from "../events.ts";
import {
  bankCandidates,
  deleteTransactions,
  findByReceipt,
  findMany,
  insertTransaction,
  listSplits,
  lockMany,
  receiptCandidates,
  replaceSplits,
  updateTransaction,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import { MATCH_AMOUNT_TOLERANCE_MINOR, MATCH_SIMILARITY, MATCH_WINDOW_DAYS } from "../settings.ts";
import type { Deps, Parts } from "./deps.ts";
import { MATCH_HANDLER, REMERGE_HANDLER, UNMERGE_HANDLER } from "./handlers.ts";

type Channel = "web" | "telegram";

const SnapshotSplit = z.object({
  categoryCode: z.string().nullable(),
  categoryId: z.string().nullable(),
  amountMinor: z.number(),
});
const snapshotSplits = (rows: readonly z.infer<typeof SnapshotSplit>[]) =>
  rows.map(({ categoryCode, categoryId, amountMinor }) => ({
    categoryCode,
    categoryId,
    amountMinor,
  }));

/** Снимок операции чека, слитой с операцией выписки: по нему разрыв возвращает чек как был. */
const Snapshot = z.object({
  receipt: z.object({
    id: z.uuid(),
    receiptId: z.uuid(),
    accountId: z.uuid(),
    direction: z.string(),
    occurredOn: z.string(),
    occurredTime: z.string().nullable(),
    amountMinor: z.number(),
    currency: z.string(),
    amountBynMinor: z.number().nullable(),
    description: z.string(),
    merchantName: z.string().nullable(),
    merchantKey: z.string().nullable(),
    categoryCode: z.string().nullable(),
    categoryId: z.string().nullable(),
    categorySource: z.string().nullable(),
    pending: z.boolean(),
    needsReview: z.boolean(),
    version: z.number(),
    createdAt: z.string(),
  }),
  splits: z.array(SnapshotSplit),
  bank: z.object({
    categoryCode: z.string().nullable(),
    categoryId: z.string().nullable(),
    categorySource: z.string().nullable(),
    // Собственная разбивка операции выписки до связи: разрыв возвращает её, а не оставляет операцию без частей.
    // Снимки, записанные до этого поля, разбивки выписки не знали — тогда её и не было.
    splits: z.array(SnapshotSplit).default([]),
  }),
});
type Snapshot = z.infer<typeof Snapshot>;

const BankPayload = z.object({ bankId: z.uuid() });
const MergePayload = z.object({
  receiptTxId: z.uuid(),
  bankId: z.uuid(),
  channel: z.enum(["web", "telegram"]).default("web"),
});

const shiftDay = (iso: string, days: number): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const shortDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

interface Scored {
  readonly row: TransactionRow;
  readonly confident: boolean;
  readonly similarity: number;
}

export function makeMatch(d: Deps, parts: Parts) {
  const { ledger } = parts;
  const { log } = d.platform;

  /** Кандидаты с оценкой «уверенный» (один контрагент справочника или название похоже не ниже порога). */
  async function score(
    anchor: TransactionRow,
    others: readonly TransactionRow[],
  ): Promise<Scored[]> {
    if (others.length === 0) return [];
    const threshold = await d.settings.get(MATCH_SIMILARITY);
    const name = (row: TransactionRow) => row.merchantName ?? row.description;
    const infos = await d.merchants.resolve([name(anchor), ...others.map(name)]);
    const home = infos[0];
    return others
      .map((row, index) => {
        const info = infos[index + 1];
        const similarity = d.merchants.similarity(name(anchor), name(row));
        const same =
          home?.merchantId != null &&
          info?.merchantId != null &&
          home.merchantId === info.merchantId;
        return { row, similarity, confident: same || similarity >= threshold };
      })
      .toSorted((a, b) =>
        a.confident === b.confident ? b.similarity - a.similarity : a.confident ? -1 : 1,
      );
  }

  async function window(anchor: TransactionRow) {
    const days = await d.settings.get(MATCH_WINDOW_DAYS);
    return {
      amountMinor: anchor.amountMinor,
      currency: anchor.currency,
      toleranceMinor: await d.settings.get(MATCH_AMOUNT_TOLERANCE_MINOR),
      from: shiftDay(anchor.occurredOn, -days),
      to: shiftDay(anchor.occurredOn, days),
    };
  }

  /** Слить: операция чека исчезает, операция выписки получает разбивку и ссылку на чек. Возвращает undoToken или undefined, если пара уже не годится. */
  async function merge(
    tx: ScopedDb,
    receiptTxId: string,
    bankId: string,
    channel: Channel,
  ): Promise<string | undefined> {
    const rows = await lockMany(tx, [receiptTxId, bankId]);
    const receipt = rows.find((row) => row.id === receiptTxId);
    const bank = rows.find((row) => row.id === bankId);
    if (
      receipt === undefined ||
      bank === undefined ||
      receipt.source !== "receipt" ||
      receipt.receiptId === null ||
      bank.source === "receipt" ||
      bank.receiptId !== null ||
      bank.type !== "expense" ||
      bank.currency !== receipt.currency
    ) {
      return undefined;
    }
    const splits = await listSplits(tx, receipt.id);
    const bankSplits = await listSplits(tx, bank.id);
    // Сумма операции — из выписки: части чека пересчитываются под неё пропорционально (сумма частей = сумме операции).
    const amounts = allocate(
      bank.amountMinor,
      splits.map((split) => split.amountMinor),
    );
    const snapshot: Snapshot = {
      receipt: {
        id: receipt.id,
        receiptId: receipt.receiptId,
        accountId: receipt.accountId,
        direction: receipt.direction,
        occurredOn: receipt.occurredOn,
        occurredTime: receipt.occurredTime,
        amountMinor: receipt.amountMinor,
        currency: receipt.currency,
        amountBynMinor: receipt.amountBynMinor,
        description: receipt.description,
        merchantName: receipt.merchantName,
        merchantKey: receipt.merchantKey,
        categoryCode: receipt.categoryCode,
        categoryId: receipt.categoryId,
        categorySource: receipt.categorySource,
        pending: receipt.pending,
        needsReview: receipt.needsReview,
        version: receipt.version,
        createdAt: receipt.createdAt.toISOString(),
      },
      splits: snapshotSplits(splits),
      bank: {
        categoryCode: bank.categoryCode,
        categoryId: bank.categoryId,
        categorySource: bank.categorySource,
        splits: snapshotSplits(bankSplits),
      },
    };
    // Категория операции выписки — своя, если человек её выбирал; иначе из чека (самая крупная часть).
    const keep = bank.categorySource === "user" || bank.categorySource === "user-rule";
    const patch = {
      receiptId: receipt.receiptId,
      needsReview: receipt.needsReview,
      mergedReceipt: snapshot,
      version: bank.version + 1,
      ...(keep
        ? {}
        : {
            categoryCode: receipt.categoryCode,
            categoryId: receipt.categoryId,
            categorySource: receipt.categorySource,
          }),
    };
    await replaceSplits(
      tx,
      bank.id,
      splits.flatMap((split, index) =>
        (amounts[index] ?? 0) > 0
          ? [
              {
                position: index + 1,
                categoryCode: split.categoryCode,
                categoryId: split.categoryId,
                amountMinor: amounts[index] ?? 0,
              },
            ]
          : [],
      ),
    );
    await updateTransaction(tx, bank.id, patch);
    await deleteTransactions(tx, [receipt.id]);
    await ledger.settle(tx, {
      batchId: randomUUID(),
      channel: "system",
      changes: [{ before: bank, after: { ...bank, ...patch } }, { before: receipt }],
    });
    await d.platform.events.publish(tx, transactionsMerged, { ids: [bank.id] });
    log.info({ transactionId: bank.id }, "transactions.merged");
    return d.actions.record(tx, {
      handler: UNMERGE_HANDLER,
      payload: { bankId: bank.id },
      subject: `transaction:${bank.id}`,
      channel,
    });
  }

  /**
   * Разорвать: чек возвращается к своей операции «без пары» (RCPT-10: наличная трата или «ожидает выписки») с теми же id,
   * разбивкой и счётом, у операции выписки снимается ссылка, а категория и собственная разбивка возвращаются из снимка.
   * Пару больше не предлагаем.
   */
  async function unmerge(tx: ScopedDb, bankId: string, channel: Channel): Promise<string> {
    const [bank] = await lockMany(tx, [bankId]);
    if (bank === undefined) throw new AppError("NOT_FOUND");
    const parsed = Snapshot.safeParse(bank.mergedReceipt);
    if (!parsed.success) throw new AppError("CONFLICT");
    const {
      receipt,
      splits,
      bank: { splits: bankSplits, ...before },
    } = parsed.data;
    const restored = await insertTransaction(tx, {
      id: receipt.id,
      accountId: receipt.accountId,
      type: "expense",
      direction: receipt.direction,
      occurredOn: receipt.occurredOn,
      occurredTime: receipt.occurredTime,
      amountMinor: receipt.amountMinor,
      currency: receipt.currency,
      amountBynMinor: receipt.amountBynMinor,
      description: receipt.description,
      merchantName: receipt.merchantName,
      merchantKey: receipt.merchantKey,
      categoryCode: receipt.categoryCode,
      categoryId: receipt.categoryId,
      categorySource: receipt.categorySource,
      source: "receipt",
      receiptId: receipt.receiptId,
      pending: receipt.pending,
      needsReview: receipt.needsReview,
      matchDeclined: [bank.id],
      version: receipt.version,
      createdAt: new Date(receipt.createdAt),
    });
    await replaceSplits(
      tx,
      restored.id,
      splits.map((split, index) => ({ ...split, position: index + 1 })),
    );
    const patch = {
      receiptId: null,
      needsReview: false,
      mergedReceipt: null,
      matchDeclined: [...bank.matchDeclined, restored.id],
      version: bank.version + 1,
      ...before,
    };
    await replaceSplits(
      tx,
      bank.id,
      bankSplits.map((split, index) => ({ ...split, position: index + 1 })),
    );
    await updateTransaction(tx, bank.id, patch);
    await ledger.settle(tx, {
      batchId: randomUUID(),
      channel: "system",
      changes: [{ after: restored }, { before: bank, after: { ...bank, ...patch } }],
    });
    return d.actions.record(tx, {
      handler: REMERGE_HANDLER,
      payload: { receiptTxId: restored.id, bankId: bank.id, channel },
      subject: `transaction:${bank.id}`,
      channel,
    });
  }

  /** «Отменить» связь (и «Это разные покупки» из уведомления): обработчик undo в actions. */
  async function undoMerge(tx: ScopedDb, payload: unknown): Promise<void> {
    await unmerge(tx, BankPayload.parse(payload).bankId, "web");
  }

  /** «Отменить» разрыв: слить снова. Пара больше не годится (чек или операцию успели изменить) — CONFLICT. */
  async function undoUnlink(tx: ScopedDb, payload: unknown): Promise<void> {
    const { receiptTxId, bankId, channel } = MergePayload.parse(payload);
    if ((await merge(tx, receiptTxId, bankId, channel)) === undefined)
      throw new AppError("CONFLICT");
  }

  /** «Да» на вопрос «одна покупка?»: слить; отдаёт undoToken «Отменить». */
  async function confirmMatch(tx: ScopedDb, payload: unknown): Promise<string | undefined> {
    const { receiptTxId, bankId, channel } = MergePayload.parse(payload);
    const undoToken = await merge(tx, receiptTxId, bankId, channel);
    if (undoToken === undefined) throw new AppError("CONFLICT", { reason: "match-changed" });
    return undoToken;
  }

  /** Автосвязь или вопрос по уже найденным кандидатам; `receiptTx` и `bankTx` выбирает вызывающий (сторона якоря). */
  async function resolve(
    s: ScopedDb,
    anchor: TransactionRow,
    scored: readonly Scored[],
    side: "receipt" | "bank",
    channel: Channel,
  ): Promise<"linked" | "asked" | "none"> {
    const best = scored[0];
    if (best === undefined) return "none";
    const receiptTx = side === "receipt" ? anchor : best.row;
    const bankTx = side === "receipt" ? best.row : anchor;
    const params = {
      store: receiptTx.merchantName ?? receiptTx.description,
      date: shortDay(receiptTx.occurredOn),
      bankDate: shortDay(bankTx.occurredOn),
    };
    if (scored.length === 1 && best.confident) {
      // Единственный уверенный кандидат — связываем сами (TXN-10) и сообщаем с «Это разные покупки».
      const linked = await s.transaction(async (tx) => {
        const undoToken = await merge(tx, receiptTx.id, bankTx.id, channel);
        if (undoToken === undefined) return false;
        await d.notifications.notify(tx, {
          kind: "receipt-match",
          key: `${receiptTx.id}:${bankTx.id}`,
          objectRef: { entity: "transaction", id: bankTx.id },
          undoToken,
          params,
        });
        return true;
      });
      return linked ? "linked" : "none";
    }
    // Несколько кандидатов или неуверенно — спрашиваем один раз: пару запоминаем и с другой стороны.
    const decisionId = await d.actions.propose(s, {
      handler: MATCH_HANDLER,
      payload: { receiptTxId: receiptTx.id, bankId: bankTx.id, channel },
      summary: { key: "decisions.receiptMatch", params },
    });
    await s.transaction(async (tx) => {
      for (const [row, other] of [
        [receiptTx, bankTx],
        [bankTx, receiptTx],
      ] as const) {
        await updateTransaction(tx, row.id, { matchDeclined: [...row.matchDeclined, other.id] });
      }
      await d.notifications.notify(tx, {
        kind: "receipt-match",
        key: `${receiptTx.id}:${bankTx.id}`,
        objectRef: { entity: "transaction", id: bankTx.id },
        decisionId,
        params,
      });
    });
    return "asked";
  }

  /** TXN-10: чек загружен — ищем платёж по карте. Вызывается после сохранения чека, вне транзакции. */
  async function matchReceipt(
    s: ScopedDb,
    receiptId: string,
    channel: Channel = "web",
  ): Promise<"linked" | "asked" | "none"> {
    const anchor = await findByReceipt(s, receiptId);
    if (anchor === undefined || anchor.source !== "receipt" || anchor.type !== "expense")
      return "none";
    const found = (await bankCandidates(s, await window(anchor))).filter(
      (row) => !anchor.matchDeclined.includes(row.id) && !row.matchDeclined.includes(anchor.id),
    );
    return resolve(s, anchor, await score(anchor, found), "receipt", channel);
  }

  /** TXN-10: выписка импортирована — для каждой её новой расходной операции ищем чек. Возвращает, сколько связано и сколько спрошено. */
  async function matchBankOps(
    s: ScopedDb,
    ids: readonly string[],
    channel: Channel = "web",
  ): Promise<{ linked: number; asked: number }> {
    const totals = { linked: 0, asked: 0 };
    for (const id of ids) {
      const [anchor] = await findMany(s, [id]);
      if (
        anchor === undefined ||
        anchor.source !== "statement" ||
        anchor.type !== "expense" ||
        anchor.receiptId !== null
      ) {
        continue;
      }
      const found = (await receiptCandidates(s, await window(anchor))).filter(
        (row) => !anchor.matchDeclined.includes(row.id) && !row.matchDeclined.includes(anchor.id),
      );
      const outcome = await resolve(s, anchor, await score(anchor, found), "bank", channel);
      if (outcome === "linked") totals.linked += 1;
      if (outcome === "asked") totals.asked += 1;
    }
    return totals;
  }

  /** TXN-11: ручная связь из карточки — чек выбирает человек. Сумма и день — из операции выписки. */
  async function linkReceipt(
    s: ScopedDb,
    input: { receiptId: string; transactionId: string },
    channel: Channel = "web",
  ): Promise<{ undoToken: string }> {
    const receiptTx = await findByReceipt(s, input.receiptId);
    if (receiptTx === undefined) throw new AppError("NOT_FOUND");
    const undoToken = await s.transaction((tx) =>
      merge(tx, receiptTx.id, input.transactionId, channel),
    );
    if (undoToken === undefined) throw new AppError("CONFLICT");
    return { undoToken };
  }

  /** TXN-11: ручной разрыв — чек возвращается к операции «без пары»; с «Отменить» (слить снова). */
  async function unlinkReceipt(
    s: ScopedDb,
    transactionId: string,
    channel: Channel = "web",
  ): Promise<{ undoToken: string }> {
    return { undoToken: await s.transaction((tx) => unmerge(tx, transactionId, channel)) };
  }

  return {
    matchReceipt,
    matchBankOps,
    linkReceipt,
    unlinkReceipt,
    undoMerge,
    undoUnlink,
    confirmMatch,
  };
}
