// Владелец данных модуля notifications (PRIV-05/06): уведомления и настройки пользователя — для «Мои данные» и
// удаления аккаунта. Уведомления администраторов — системные (без домохозяйства), сюда не входят.
import { defineUserData } from "../../platform/db/user-data.ts";
import { notificationPreferences, notifications } from "./infrastructure/db/schema.ts";

export const notificationsUserData = defineUserData({
  tables: [notifications, notificationPreferences],
});
