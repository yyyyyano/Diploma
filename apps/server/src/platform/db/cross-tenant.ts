// crossTenant (ARCHITECTURE §6.6): единственный запрос «для всех домохозяйств» — найти владельцев строк, которым
// нужна работа (тик напоминаний, итоги недели, зависшие чеки). Аудитор пропускает только один SELECT, возвращающий
// id, household_id, user_id; дальше — задача на каждую строку под scope владельца. Импортируют его только
// platform/jobs (defineSweep) и *.sweep.ts (правило cross-tenant-only-in-sweeps).
import { auditedDrizzle, type DbClient, type QueryDb } from "./audited.ts";

/** Найденный владелец строки — ровно то, что можно вынести из сквозного запроса. */
export interface OwnerRow {
  readonly id: string;
  readonly householdId: string;
  readonly userId: string;
}

/**
 * Выполнить сквозной поиск владельцев. `label` — имя обхода для журнала и ошибок (T-006 пишет его в лог).
 * Любой другой запрос внутри fn — ISOLATION_VIOLATION.
 */
export async function crossTenant<R extends readonly OwnerRow[]>(
  client: DbClient,
  label: string,
  find: (db: QueryDb) => Promise<R>,
): Promise<R> {
  if (label.trim() === "")
    throw new Error("crossTenant: укажите имя обхода (label) — оно попадает в журнал.");
  return find(auditedDrizzle(client, { kind: "cross-tenant" }));
}
