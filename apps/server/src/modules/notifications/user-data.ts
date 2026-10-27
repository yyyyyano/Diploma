// Владелец данных модуля notifications (PRIV-05/06): уведомления и настройки пользователя — для «Мои данные» и
// удаления аккаунта. Уведомления администраторов — системные (без домохозяйства), в таблицы не входят; отметки
// «прочитано» удалённого администратора убирает хук afterDelete.
import { defineUserData } from "../../platform/db/user-data.ts";
import type { AdminNotifications } from "./application/admin-notifications.ts";
import { notificationPreferences, notifications } from "./infrastructure/db/schema.ts";

export function notificationsUserData(admins: Pick<AdminNotifications, "forgetAdmin">) {
  return defineUserData({
    tables: [notifications, notificationPreferences],
    // Отметки «прочитано» администратора — systemTable: их убирает хук после удаления строк домохозяйства.
    afterDelete: admins.forgetAdmin,
  });
}
