// Адрес настроек: открытая вкладка (по ней ведёт «Настроить уведомления» колокольчика). Неизвестная — первая.
import { z } from "zod";

export const SETTINGS_TABS = ["profile", "notifications"] as const;

export const SettingsSearch = z.object({
  tab: z.enum(SETTINGS_TABS).optional().catch(undefined),
});
export type SettingsSearch = z.infer<typeof SettingsSearch>;
