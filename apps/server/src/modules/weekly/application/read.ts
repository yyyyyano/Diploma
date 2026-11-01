// Чтение итогов недели (WEEK-01, WEEK-03, DASH-02): последняя сводка для карточки на главной, история и настройки пользователя.
// Настройки по умолчанию (нет строки пользователя) — из системных настроек; первое чтение создаёт строку: так пользователь попадает
// в обход итогов недели и тогда, когда зарегистрировался раньше этого модуля.
import { WeeklySummary, type WeeklyPreferences } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import {
  ensurePreferences,
  findPreferences,
  listSummaries,
  savePreferences,
  type SummaryRow,
} from "../infrastructure/db/weekly.repo.ts";
import { DEFAULT_TIME, DEFAULT_WEEKDAY } from "../settings.ts";
import type { Deps } from "./deps.ts";

/** Сохранённая сводка → ответ сайту: числа с traceId лежат готовыми, текст и день — рядом; повреждённая строка не показывается. */
function toSummary(row: SummaryRow): WeeklySummary | null {
  const parsed = WeeklySummary.safeParse({
    ...row.facts,
    id: row.id,
    text: row.text,
    textSource: row.textSource,
    createdAt: row.createdAt.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

export function makeRead(d: Pick<Deps, "platform">) {
  const { settings } = d.platform;

  async function history(s: ScopedDb, limit = 20): Promise<WeeklySummary[]> {
    return (await listSummaries(s, limit)).flatMap((row) => {
      const summary = toSummary(row);
      return summary === null ? [] : [summary];
    });
  }

  async function latest(s: ScopedDb): Promise<WeeklySummary | null> {
    if ((await findPreferences(s)) === undefined) await ensurePreferences(s);
    return (await history(s, 1))[0] ?? null;
  }

  async function preferences(s: ScopedDb): Promise<WeeklyPreferences> {
    if ((await findPreferences(s)) === undefined) await ensurePreferences(s);
    const row = await findPreferences(s);
    return {
      enabled: row?.enabled ?? true,
      weekday: row?.weekday ?? (await settings.get(DEFAULT_WEEKDAY)),
      time: row?.time ?? (await settings.get(DEFAULT_TIME)),
    };
  }

  async function setPreferences(s: ScopedDb, value: WeeklyPreferences): Promise<WeeklyPreferences> {
    await savePreferences(s, value);
    return preferences(s);
  }

  return { latest, history, preferences, setPreferences };
}

export type Read = ReturnType<typeof makeRead>;
