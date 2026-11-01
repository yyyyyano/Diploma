// Владелец данных модуля calendar (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше родителей.
import { defineUserData } from "../../platform/db/user-data.ts";
import { calendarEvents, calendarReminders } from "./infrastructure/db/schema.ts";

export const calendarUserData = defineUserData({ tables: [calendarReminders, calendarEvents] });
