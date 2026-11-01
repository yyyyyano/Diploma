// Владелец данных модуля weekly (PRIV-05/06): настройки и история сводок — для «Мои данные» и удаления аккаунта.
import { defineUserData } from "../../platform/db/user-data.ts";
import { weeklyPreferences, weeklySummaries } from "./infrastructure/db/schema.ts";

export const weeklyUserData = defineUserData({ tables: [weeklySummaries, weeklyPreferences] });
