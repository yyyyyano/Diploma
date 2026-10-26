// Владелец данных модуля explain (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { explanations } from "./infrastructure/db/schema.ts";

export const explainUserData = defineUserData({ tables: [explanations] });
