// Журнал фоновых задач background_job_run (OBS-07, NFR-22): запросы через SystemDb, проходят аудитор. Перед каждой
// новой строкой удаляются до PURGE_BATCH строк старше RETENTION_DAYS — отдельной задачи очистки нет (как у
// rate_limits); строка с текущим водяным знаком расписания не удаляется, сколько бы ей ни было лет, иначе после
// долгого простоя догон начался бы заново. Время приходит из Clock вызывающего, а не из now() базы.
import type { LocalDate } from "@kosht/kernel";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { SystemDb } from "../db/system-db.ts";
import { backgroundJobRun, type RunStatus } from "./schema.ts";

/** Сколько дней хранится журнал запусков. */
export const RETENTION_DAYS = 30;
/** Сколько старых строк удаляется за одну новую. */
export const PURGE_BATCH = 100;

const DAY_MS = 86_400_000;

export interface RunStart {
  readonly kind: string;
  readonly scheduleKey?: string;
  readonly startedAt: Date;
}

/** Запуск начался: строка running; вернуть её id. */
export async function startRun(db: SystemDb, run: RunStart): Promise<string> {
  await purgeOld(db, run.startedAt);
  const [row] = await db
    .insert(backgroundJobRun)
    .values({
      kind: run.kind,
      scheduleKey: run.scheduleKey ?? null,
      status: "running",
      startedAt: run.startedAt,
    })
    .returning({ id: backgroundJobRun.id });
  if (row === undefined) throw new Error("background_job_run: insert не вернул строку.");
  return row.id;
}

export interface RunFinish {
  readonly status: Exclude<RunStatus, "running">;
  readonly finishedAt: Date;
  readonly errorCode?: string;
  readonly watermark?: LocalDate;
}

/** Запуск закончился: статус, код ошибки, водяной знак расписания. */
export async function finishRun(db: SystemDb, id: string, finish: RunFinish): Promise<void> {
  await db
    .update(backgroundJobRun)
    .set({
      status: finish.status,
      finishedAt: finish.finishedAt,
      errorCode: finish.errorCode ?? null,
      ...(finish.watermark === undefined ? {} : { watermark: finish.watermark }),
    })
    .where(eq(backgroundJobRun.id, id));
}

/** Задача отброшена без выполнения: одна завершённая строка dropped. */
export async function recordDropped(
  db: SystemDb,
  run: RunStart & { readonly errorCode: string },
): Promise<void> {
  await purgeOld(db, run.startedAt);
  await db.insert(backgroundJobRun).values({
    kind: run.kind,
    status: "dropped",
    errorCode: run.errorCode,
    startedAt: run.startedAt,
    finishedAt: run.startedAt,
  });
}

/** Прогресс запуска 0…100. */
export async function setProgress(db: SystemDb, id: string, percent: number): Promise<void> {
  await db.update(backgroundJobRun).set({ progress: percent }).where(eq(backgroundJobRun.id, id));
}

/** Водяной знак расписания: последний день, обработанный завершённым запуском; не было — undefined. */
export async function lastWatermark(
  db: SystemDb,
  scheduleKey: string,
): Promise<LocalDate | undefined> {
  const [row] = await db
    .select({ watermark: backgroundJobRun.watermark })
    .from(backgroundJobRun)
    .where(
      and(
        eq(backgroundJobRun.scheduleKey, scheduleKey),
        eq(backgroundJobRun.status, "completed"),
        isNotNull(backgroundJobRun.watermark),
      ),
    )
    .orderBy(desc(backgroundJobRun.watermark))
    .limit(1);
  return (row?.watermark ?? undefined) as LocalDate | undefined;
}

async function purgeOld(db: SystemDb, now: Date): Promise<void> {
  const before = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  await db.delete(backgroundJobRun).where(
    sql`ctid = any(array(
      select r.ctid from background_job_run r
      where r.started_at < ${before}
        and not (r.status = 'completed' and r.watermark is not null and r.watermark >= (
          select max(w.watermark) from background_job_run w
          where w.schedule_key = r.schedule_key and w.status = 'completed'))
      limit ${PURGE_BATCH} for update of r skip locked))`,
  );
}
