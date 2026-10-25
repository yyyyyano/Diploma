// Экземпляр pg-boss процесса (ADR-0008, ADR-0020, ARCHITECTURE §3): единственное место настроек очереди. Своего
// пула нет — db-адаптер на пул роли приложения (platform/db/boss-db.ts). api и bot только ставят задачи: без
// обработчиков, расписаний и обслуживания; worker обрабатывает задачи, ведёт расписания и обслуживает очередь
// (просроченные и старые задачи, журнал экземпляров) с явными интервалами. Схему ставит владелец
// (install.ts), поэтому migrate: false — процесс только сверяет её версию.
import { PgBoss, type ConstructorOptions } from "pg-boss";
import type { BossDb } from "../db/boss-db.ts";
import { JOBS_SCHEMA } from "./install.ts";

/** Роль процесса (ARCHITECTURE §3): очередь обслуживает только worker. */
export type BossRole = "api" | "worker" | "bot";

/** Проход обслуживания (просрочка, удаление, журнал экземпляров) и подсчёт очередей — раз в минуту. */
export const SUPERVISE_INTERVAL_SECONDS = 60;
export const MONITOR_INTERVAL_SECONDS = 60;
/** Отметка «экземпляр жив» в журнале экземпляров pg-boss. */
export const INSTANCE_HEARTBEAT_SECONDS = 30;
/**
 * Остановка: обработчики в полёте доводятся не дольше 8 с — остаток срока остановки процесса (10 с,
 * STOP_TIMEOUT_MS в entrypoints/run.ts) уходит на пул и лог.
 */
export const BOSS_STOP_TIMEOUT_MS = 8000;

/**
 * reindex: false: перестраивать индексы роль приложения всё равно не может (они принадлежат владельцу), а поиск
 * раздутых индексов читает pg_stats, закрытый ей (ADR-0020: статистика планировщика показывает значения строк всех
 * домохозяйств). Без поиска pg-boss 12.38 не умеет — его выключает наш патч `patches/pg-boss@12.38.0.patch`
 * (`reindex: false` → проход без поиска). Обновление pg-boss не поставится, пока патч не перенесён, а проход
 * обслуживания под ролью приложения проверяет jobs.int.test.ts.
 */

export function createBoss(db: BossDb, role: BossRole): PgBoss {
  const worker = role === "worker";
  const options: ConstructorOptions = {
    db,
    schema: JOBS_SCHEMA,
    migrate: false,
    createSchema: false,
    supervise: worker,
    schedule: worker,
    superviseIntervalSeconds: SUPERVISE_INTERVAL_SECONDS,
    monitorIntervalSeconds: MONITOR_INTERVAL_SECONDS,
    instanceName: role,
    instanceHeartbeatSeconds: INSTANCE_HEARTBEAT_SECONDS,
    reindex: false,
  };
  return new PgBoss(options);
}

/** Остановить: новые задачи не берутся, обработчики в полёте доводятся (≤ BOSS_STOP_TIMEOUT_MS); пул — не наш. */
export async function stopBoss(boss: PgBoss): Promise<void> {
  await boss.stop({ graceful: true, timeout: BOSS_STOP_TIMEOUT_MS, close: false });
}
