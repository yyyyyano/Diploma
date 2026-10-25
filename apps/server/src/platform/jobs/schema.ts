// Журнал фоновых задач (OBS-07, ADR-0008, ARCHITECTURE §9): строка на запуск — вид, статус, прогресс, ошибка;
// у расписаний платформы — ещё водяной знак: последний обработанный день периода (NFR-22: догон после простоя).
// Вид — systemTable платформы: ни household_id, ни user_id (журнал читает админка, PRIV-07), доступ только из
// platform/jobs через SystemDb. Водяные знаки расписаний «для каждого пользователя» живут в таблицах модулей
// (ADR-0008). Имя — единственное число, как в ADR-0008 и SPEC.
import { sql } from "drizzle-orm";
import { check, date, index, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { systemTable } from "../db/tables.ts";

/** Статус запуска: dropped — задача отброшена без выполнения (конверт или владелец не прошли проверку). */
export const RUN_STATUSES = ["running", "completed", "failed", "dropped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const backgroundJobRun = systemTable(
  "background_job_run",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    /** Вид: имя задачи или очереди расписания (`receipts.recognize`, `sweep.calendar-remind`). */
    kind: text().notNull(),
    /** Ключ расписания платформы — по нему ищется водяной знак; у задач — null. */
    scheduleKey: text(),
    status: text().$type<RunStatus>().notNull(),
    /** 0…100, если задача сообщает прогресс. */
    progress: smallint(),
    /** Последний обработанный день периода расписания (ГГГГ-ММ-ДД). */
    watermark: date({ mode: "string" }),
    /** Код ошибки каталога (INTERNAL — для прочих); текста ошибки нет (OBS-04). */
    errorCode: text(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "background_job_run_status_check",
      sql`${t.status} in ('running', 'completed', 'failed', 'dropped')`,
    ),
    check("background_job_run_progress_check", sql`${t.progress} between 0 and 100`),
    // Экран «Система» — последние запуски; очистка старых строк — по started_at.
    index("background_job_run_started_at_idx").on(t.startedAt),
    // Водяной знак расписания — последний завершённый запуск по ключу.
    index("background_job_run_schedule_key_watermark_idx")
      .on(t.scheduleKey, t.watermark)
      .where(sql`${t.scheduleKey} is not null`),
  ],
);
