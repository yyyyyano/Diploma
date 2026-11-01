// transactions.changed и profile.facts-changed → поиск оснований для вычетов (TAX-20). Нагрузке не верим: поиск перечитывает
// операции и профиль целиком, «потерянные» при схлопывании id ничего не значат; импорт на 300 операций — одно событие и один
// поиск (одна ожидающая задача на пользователя). Результата в этот же момент никто не ждёт — отложенного старта нет, но и
// быстрого опроса (0,5 с, как у лимитов) тоже: уведомление «найден вычет» приходит в пределах нескольких секунд.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { factsChanged } from "../../profile/index.ts";
import { transactionsChanged } from "../../transactions/index.ts";

const options = {
  singletonKey: (_payload: unknown, scope: Parameters<typeof jobKey>[0]) =>
    jobKey(scope, "tax.detect-found"),
  pollingIntervalSeconds: 1,
} as const;

export function onTransactionsChanged(detect: (s: ScopedDb) => Promise<unknown>) {
  return defineSubscription({
    event: transactionsChanged,
    module: "tax",
    options,
    handle: async (ctx) => {
      await detect(ctx.s);
    },
  });
}

export function onFactsChanged(detect: (s: ScopedDb) => Promise<unknown>) {
  return defineSubscription({
    event: factsChanged,
    module: "tax",
    options,
    handle: async (ctx) => {
      await detect(ctx.s);
    },
  });
}
