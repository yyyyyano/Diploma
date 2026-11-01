// Владелец данных модуля telegram (PRIV-06): таблиц домохозяйства нет — привязка, коды и связи чек → чат лежат в системных
// таблицах; удаление аккаунта убирает их хуком afterDelete (идемпотентно: повтор после сбоя доходит до конца).
import type { SystemDb } from "../../platform/db/system-db.ts";
import { defineUserData } from "../../platform/db/user-data.ts";
import {
  deleteCodesOfHousehold,
  deleteLinkByHousehold,
  deleteReceiptCardsOfHousehold,
} from "./infrastructure/db/telegram.repo.ts";

export function telegramUserData(system: SystemDb) {
  return defineUserData({
    tables: [],
    afterDelete: async (scope) => {
      await deleteLinkByHousehold(system, scope.householdId);
      await deleteCodesOfHousehold(system, scope.householdId);
      await deleteReceiptCardsOfHousehold(system, scope.householdId);
    },
  });
}
