// Владелец данных модуля privacy (PRIV-05/06): заявки на архив и журнал согласий — для «Мои данные» и удаления
// аккаунта (сами архивы — файлы files, их удаляет хук files); режим пользователя для админки (privacy_modes,
// systemTable) убирает хук afterDelete.
import type { SystemDb } from "../../platform/db/system-db.ts";
import { defineUserData } from "../../platform/db/user-data.ts";
import { deleteMode } from "./infrastructure/db/modes.repo.ts";
import { privacyConsents, privacyExports } from "./infrastructure/db/schema.ts";

export function privacyUserData(system: SystemDb) {
  return defineUserData({
    tables: [privacyExports, privacyConsents],
    afterDelete: async (scope) => deleteMode(system, scope.userId),
  });
}
