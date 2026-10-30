// Владелец данных модуля recurring (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { recurringItems, recurringRevisions } from "./infrastructure/db/schema.ts";

export const recurringUserData = defineUserData({ tables: [recurringRevisions, recurringItems] });
