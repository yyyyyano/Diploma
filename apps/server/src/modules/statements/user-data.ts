// Владелец данных модуля statements (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { statementFormats } from "./infrastructure/db/schema.ts";

export const statementsUserData = defineUserData({ tables: [statementFormats] });
