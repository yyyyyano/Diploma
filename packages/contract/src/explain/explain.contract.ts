// «Откуда эта цифра?» (EXPL-01, EXPL-02, P2): сохранённая трасса расчёта по traceId — ровно та, которой получено
// число, а не пересчитанная заново. Подписи узлов сайт берёт из словаря formulas по key, значения — Money или целые.
import { TraceId, type TraceNode } from "@kosht/kernel";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const TraceRef = z.strictObject({
  kind: z.enum(["transaction", "fragmentVersion", "fxRate"]),
  id: z.string().min(1).max(64),
});

/** Узел трассы (тип — @kosht/kernel): дерево, глубина — по расчёту. */
export const TraceNodeSchema: z.ZodType<TraceNode> = z.lazy(() =>
  z.strictObject({
    key: z.string().regex(/^[a-z]+(\.[a-zA-Z0-9-]+)*$/),
    op: z.enum(["value", "sum", "sub", "mul", "avg", "round"]),
    value: z.union([Money.schema, z.int()]),
    inputs: z.array(TraceNodeSchema),
    refs: z.array(TraceRef),
    note: z.string().max(200).exactOptional(),
  }),
);

export const Explanation = z.strictObject({
  id: TraceId,
  trace: TraceNodeSchema,
  /** Период, за который считали («по 3 полным месяцам: июль–сентябрь»); нет — расчёт не о периоде. */
  period: z.strictObject({ from: LocalDate.schema, to: LocalDate.schema }).nullable(),
  createdAt: z.iso.datetime(),
});
export type Explanation = z.infer<typeof Explanation>;

export const explainContract = {
  /** Сохранённый расчёт; чужой или неизвестный — NOT_FOUND. */
  get: oc
    .route({ method: "GET", path: "/explain" })
    .input(z.strictObject({ id: TraceId }))
    .output(Explanation)
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
};
