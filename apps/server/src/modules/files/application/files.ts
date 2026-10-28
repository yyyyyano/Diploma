// Файлы домохозяйства (SEC-03, RCPT-11, STMT-10, PRIV-05/06, ARCHITECTURE §6.6): сохранить, выдать, удалить. Путь
// строит сервер из домохозяйства scope и id (BlobStore), имя из запроса — только метаданные (очищенное). Выдача —
// только после поиска строки через s: чужой id неотличим от несуществующего — NOT_FOUND. Порядок записи: id
// (uuidv7, как у базы) → файл в хранилище (вне транзакции) → строка; строка не записалась — файл удаляется. Приём с
// проверкой типа по содержимому и лимитами — T-025: здесь вид, имя и тип задаёт код сервера, а не человек.
import { FileId, type Scope } from "@kosht/kernel";
import { randomUUIDv7 } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { ExportSink } from "../../../platform/db/user-data.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { safeFileName } from "../domain/file-name.ts";
import {
  deleteFile,
  findFile,
  insertFile,
  listFiles,
  type FileRow,
} from "../infrastructure/db/files.repo.ts";
import type { FileKind } from "../domain/file-kind.ts";

export interface NewFile {
  readonly kind: FileKind;
  /** Имя для показа и скачивания (очищается); в путь не попадает. */
  readonly name: string;
  readonly mime: string;
  /** Содержимое целиком или потоком кусков (архив «Мои данные» — потоком). */
  readonly content: Uint8Array | AsyncIterable<Uint8Array>;
}

/** Файл, открытый для выдачи владельцу: метаданные и содержимое (Blob читается при отправке). */
export interface OpenedFile extends FileRow {
  readonly blob: Blob;
}

export function makeFiles(d: Pick<Platform, "blobs" | "clock" | "log">) {
  /** Сохранить файл домохозяйства s; id и размер — для ссылок соседей (чек, выписка, архив). */
  async function save(s: ScopedDb, file: NewFile): Promise<{ id: FileId; size: number }> {
    const { householdId } = s.scope;
    const id = FileId.parse(randomUUIDv7());
    let size: number;
    if (file.content instanceof Uint8Array) {
      await d.blobs.put(householdId, id, file.content);
      size = file.content.byteLength;
    } else {
      size = await d.blobs.putStream(householdId, id, file.content);
    }
    try {
      await insertFile(
        s,
        { id, kind: file.kind, name: safeFileName(file.name), mime: file.mime, size },
        d.clock.now(),
      );
    } catch (error) {
      await d.blobs.delete(householdId, id);
      throw error;
    }
    d.log.info({ fileId: id, size }, "files.saved");
    return { id, size };
  }

  /** Файл для выдачи владельцу; чужой, несуществующий или потерянный на диске — NOT_FOUND. */
  async function open(s: ScopedDb, id: FileId): Promise<OpenedFile> {
    const row = await findFile(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    const blob = await d.blobs.open(s.scope.householdId, id);
    if (blob === undefined) {
      d.log.warn({ fileId: id }, "files.blob-missing");
      throw new AppError("NOT_FOUND");
    }
    return { ...row, blob };
  }

  /** Удалить файл домохозяйства; чужого или уже удалённого нет — ничего не происходит. */
  async function remove(s: ScopedDb, id: FileId): Promise<void> {
    if (await deleteFile(s, id)) await d.blobs.delete(s.scope.householdId, id);
  }

  /** PRIV-05: исходные файлы в архив — «<id>-<имя>», кроме прежних архивов «Мои данные». */
  async function exportFiles(s: ScopedDb, sink: ExportSink): Promise<void> {
    for (const row of await listFiles(s, "data-export")) {
      const blob = await d.blobs.open(s.scope.householdId, row.id);
      if (blob === undefined) {
        d.log.warn({ fileId: row.id }, "files.blob-missing");
        continue;
      }
      await sink.file(`${row.id}-${row.name}`, blob);
    }
  }

  /** PRIV-06: после удаления строк — весь каталог файлов домохозяйства (и файлы без строки, если были). */
  async function removeHousehold(scope: Scope): Promise<void> {
    await d.blobs.deleteHousehold(scope.householdId);
  }

  return { save, open, remove, exportFiles, removeHousehold };
}

export type Files = ReturnType<typeof makeFiles>;
