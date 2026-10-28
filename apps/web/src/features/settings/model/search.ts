// Адрес настроек: открытая вкладка (по ней ведут «Настроить уведомления» колокольчика и «Показать» уведомления
// «архив готов» — my-data). Неизвестная — первая.
import { z } from "zod";

export const SETTINGS_TABS = ["profile", "privacy", "notifications"] as const;

export const SettingsSearch = z.object({
  tab: z.enum(SETTINGS_TABS).optional().catch(undefined),
});
export type SettingsSearch = z.infer<typeof SettingsSearch>;
