// Владелец данных модуля transactions (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import {
  transactionRevisions,
  transactionSplits,
  transactions,
} from "./infrastructure/db/schema.ts";

export const transactionsUserData = defineUserData({
  tables: [transactionSplits, transactionRevisions, transactions],
});
