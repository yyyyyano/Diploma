// Владелец данных модуля actions (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { actionJournal, pendingDecisions } from "./infrastructure/db/schema.ts";

export const actionsUserData = defineUserData({ tables: [pendingDecisions, actionJournal] });
