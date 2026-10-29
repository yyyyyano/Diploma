// Процедуры transactions (contract.transactions.*): тонко — authed (домохозяйство из сессии) → сценарий. Канал
// «Отменить» — сайт, источник операции — «вручную».
import { authed } from "../../../platform/http/procedures.ts";
import type { Operations } from "../application/operations.ts";

const WEB = { channel: "web", source: "manual" } as const;

export function transactionsRouter(ops: Operations) {
  return {
    list: authed.transactions.list.handler(({ input, context }) => ops.list(context.s, input)),
    get: authed.transactions.get.handler(({ input, context }) => ops.get(context.s, input.id)),
    create: authed.transactions.create.handler(({ input, context }) =>
      ops.create(context.s, input, WEB),
    ),
    update: authed.transactions.update.handler(({ input, context }) =>
      ops.update(context.s, input, WEB),
    ),
    requestDelete: authed.transactions.requestDelete.handler(async ({ input, context }) => ({
      decisionId: await ops.requestDelete(context.s, input.ids, "web"),
    })),
    explainRate: authed.transactions.explainRate.handler(async ({ input, context }) => ({
      traceId: await ops.explainRate(context.s, input.id),
    })),
  };
}
