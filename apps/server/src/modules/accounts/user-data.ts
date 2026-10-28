// Владелец данных accounts (PRIV-05/06): счета и их ревизии выгружаются в «Мои данные» и удаляются вместе с аккаунтом;
// дети раньше родителей (ревизии ссылаются на счета).
import { defineUserData } from "../../platform/db/user-data.ts";
import { accountRevisions, accounts } from "./infrastructure/db/schema.ts";

export const accountsUserData = defineUserData({ tables: [accountRevisions, accounts] });
