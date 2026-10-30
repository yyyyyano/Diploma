// Свободный остаток (FIN-20, FIN-21, EXPL-01): средний регулярный доход «на руки» за полные месяцы истории, обязательные
// платежи по группам и их разность — с traceId у каждого числа («Откуда эта цифра?» показывает сохранённый расчёт).
// История короче трёх месяцев — «по данным за N мес.»; полных месяцев нет — числа нет (`null` и причина), а не ноль.
import { oc } from "@orpc/contract";
import { TraceId } from "@kosht/kernel";
import { z } from "zod";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

/** Группы обязательных платежей разбивки: ЖКХ, аренда, связь, кредиты, подписки, прочие обязательные. */
export const OBLIGATION_GROUPS = [
  "utilities",
  "rent",
  "communication",
  "loan",
  "subscriptions",
  "other",
] as const;
export const ObligationGroup = z.enum(OBLIGATION_GROUPS);
export type ObligationGroup = z.infer<typeof ObligationGroup>;

/** Почему свободного остатка нет: мало истории (нет полного месяца) или нет регулярного дохода. */
export const FreeBalanceReason = z.enum(["insufficient-history", "no-regular-income"]);
export type FreeBalanceReason = z.infer<typeof FreeBalanceReason>;

export const ObligationRow = z.strictObject({
  group: ObligationGroup,
  amount: Money.schema,
  traceId: TraceId,
});

export const FreeBalance = z.strictObject({
  onDate: LocalDate.schema,
  /** «По данным за N мес.»: полные месяцы с первой операции, не больше трёх; 0 — считать не за что. */
  months: z.int().min(0).max(12),
  /** Какие месяцы взяты в расчёт («июль–сентябрь»); нет истории — null. */
  window: z.strictObject({ from: LocalDate.schema, to: LocalDate.schema }).nullable(),
  freeBalance: Money.schema.nullable(),
  freeBalanceTraceId: TraceId.nullable(),
  reason: FreeBalanceReason.nullable(),
  /** Средний регулярный доход в месяц «на руки» (FIN-21). */
  income: Money.schema,
  incomeTraceId: TraceId.nullable(),
  obligations: z.array(ObligationRow),
});
export type FreeBalance = z.infer<typeof FreeBalance>;

export const finContract = {
  freeBalance: oc
    .route({ method: "GET", path: "/fin/free-balance" })
    .input(z.strictObject({}))
    .output(FreeBalance)
    .errors(pickErrors("UNAUTHORIZED")),
};
