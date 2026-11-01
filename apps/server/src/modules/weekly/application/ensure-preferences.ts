// Строка настроек итогов недели для пользователя (WEEK-03): создаётся при регистрации и при первом чтении — так пользователь попадает
// в обход. Идемпотентно: повтор ничего не меняет.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { ensurePreferences } from "../infrastructure/db/weekly.repo.ts";

export async function ensureWeeklyPreferences(s: ScopedDb): Promise<void> {
  await ensurePreferences(s);
}
