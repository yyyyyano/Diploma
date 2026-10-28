// Владелец данных модуля profile (PRIV-05/06): факты, их ревизии и признак анкеты — в «Мои данные» и удаление
// аккаунта; дети раньше родителей (ревизии ссылаются на факты).
import { defineUserData } from "../../platform/db/user-data.ts";
import { profileFactRevisions, profileFacts, profiles } from "./infrastructure/db/schema.ts";

export const profileUserData = defineUserData({
  tables: [profileFactRevisions, profileFacts, profiles],
});
