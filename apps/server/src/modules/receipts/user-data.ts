// Владелец данных модуля receipts (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше
// родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { receiptAttempts, receiptItems, receipts } from "./infrastructure/db/schema.ts";

export const receiptsUserData = defineUserData({
  tables: [receiptAttempts, receiptItems, receipts],
});
