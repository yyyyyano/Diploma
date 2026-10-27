// Удаление данных аккаунта (PRIV-06, ARCHITECTURE §6.6) по реестру владельцев данных: privacy не знает модулей —
// реестр даёт корень композиции (Platform.userData(), позднее связывание). Порядок:
//   1) строки домохозяйства во всех таблицах владельцев — одной транзакцией, модули в порядке, обратном modules.ts
//      (верхние ссылаются на нижние), таблицы модуля — в его порядке (дети раньше родителей);
//   2) хуки afterDelete владельцев (каталог файлов, системные таблицы модулей, трассы Langfuse) — после коммита, вне
//      транзакции (файлы и HTTP в транзакции нельзя), в том же обратном порядке.
// Всё идемпотентно: упавшее посередине удаление повторяется с начала и доходит до конца. Запись identity удаляет
// identity последней — после этого сценария.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { deleteOwnedRows } from "../infrastructure/db/owned-rows.repo.ts";

export function makePurgeAccount(d: Pick<Platform, "userData" | "log">) {
  return async function purge(s: ScopedDb): Promise<void> {
    const owners = d.userData().toReversed();
    const rows = await s.transaction(async (tx) => {
      let total = 0;
      for (const owner of owners) {
        for (const table of owner.data.tables) total += await deleteOwnedRows(tx, table);
      }
      return total;
    });
    for (const owner of owners) await owner.data.afterDelete?.(s.scope);
    d.log.info({ userId: s.scope.userId, count: rows }, "privacy.account-purged");
  };
}
