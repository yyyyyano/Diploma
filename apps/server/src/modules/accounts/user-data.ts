// Владелец данных accounts (PRIV-05/06): счета выгружаются в «Мои данные» и удаляются вместе с аккаунтом.
import { defineUserData } from "../../platform/db/user-data.ts";
import { accounts } from "./infrastructure/db/schema.ts";

export const accountsUserData = defineUserData({ tables: [accounts] });
