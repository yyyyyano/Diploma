// «Наличные» есть у каждого пользователя с самого начала (STMT-01): создаются по событию identity.user-registered.
// Доставка «хотя бы раз» — создание идемпотентно (уникальный индекс); сигнал «счета изменились» уходит при коммите
// и только если счёт действительно создан — список на сайте обновляется без перезагрузки (NFR-21).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { createCashIfMissing } from "../infrastructure/db/accounts.repo.ts";

export function makeEnsureCash(d: Pick<Platform, "realtime" | "log" | "clock">) {
  return async function ensureCash(s: ScopedDb): Promise<void> {
    await s.transaction(async (tx) => {
      const created = await createCashIfMissing(tx, d.clock.today());
      if (created.length === 0) return;
      await d.realtime.changed(tx, { entity: "account", ids: created });
      for (const accountId of created) d.log.info({ accountId }, "accounts.cash-created");
    });
  };
}
