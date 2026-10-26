// Владелец данных модуля privacy (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { privacyConsents } from "./infrastructure/db/schema.ts";

export const privacyUserData = defineUserData({ tables: [privacyConsents] });
