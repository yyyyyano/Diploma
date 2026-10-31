// Владелец данных модуля legal-consult (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { checklistProgress } from "./infrastructure/db/schema.ts";

export const legalConsultUserData = defineUserData({ tables: [checklistProgress] });
