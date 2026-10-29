// Состояние локальных моделей (llm_local_models, systemTable): строки пишет worker при скачивании, читает api для
// прогресса в админке и на экране первого запуска. Только служебное: путь, состояние, байты, код ошибки.
import { eq } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { llmLocalModels, type LocalModelStatus } from "./schema.ts";

export interface LocalModelRow {
  readonly id: string;
  readonly file: string;
  readonly model: string;
  readonly status: LocalModelStatus;
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly errorCode: string | null;
  readonly updatedAt: Date;
}

export async function listLocalModelRows(db: SystemDb): Promise<LocalModelRow[]> {
  return db.select().from(llmLocalModels);
}

export interface LocalModelWrite {
  readonly file: string;
  readonly model: string;
  readonly status: LocalModelStatus;
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly errorCode: string | null;
  readonly at: Date;
}

/** Строка файла: создаётся или обновляется целиком; возвращает её id. */
export async function upsertLocalModel(db: SystemDb, write: LocalModelWrite): Promise<string> {
  const values = {
    model: write.model,
    status: write.status,
    bytesDone: write.bytesDone,
    bytesTotal: write.bytesTotal,
    errorCode: write.errorCode,
    updatedAt: write.at,
  };
  const [row] = await db
    .insert(llmLocalModels)
    .values({ file: write.file, ...values })
    .onConflictDoUpdate({ target: llmLocalModels.file, set: values })
    .returning({ id: llmLocalModels.id });
  if (row === undefined) throw new Error("llm_local_models: строка не записана");
  return row.id;
}

/** Только прогресс: байты и момент, состояние не трогается. */
export async function setLocalModelProgress(
  db: SystemDb,
  file: string,
  bytesDone: number,
  at: Date,
): Promise<void> {
  await db
    .update(llmLocalModels)
    .set({ bytesDone, updatedAt: at })
    .where(eq(llmLocalModels.file, file));
}
