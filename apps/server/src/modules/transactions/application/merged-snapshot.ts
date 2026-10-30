// Снимок слитой «чек + выписка» операции (TXN-10, TXN-11): по нему разрыв связи и «Отменить» чека возвращают чек и
// собственные категорию и разбивку операции выписки такими, как они были до связи.
import { z } from "zod";

export const SnapshotSplit = z.object({
  categoryCode: z.string().nullable(),
  categoryId: z.string().nullable(),
  amountMinor: z.number(),
});
export const snapshotSplits = (rows: readonly z.infer<typeof SnapshotSplit>[]) =>
  rows.map(({ categoryCode, categoryId, amountMinor }) => ({
    categoryCode,
    categoryId,
    amountMinor,
  }));

/** Снимок операции чека, слитой с операцией выписки: по нему разрыв возвращает чек как был. */
export const Snapshot = z.object({
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
export type Snapshot = z.infer<typeof Snapshot>;
