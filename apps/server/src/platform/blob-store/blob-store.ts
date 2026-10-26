// Хранилище файлов пользователей (SEC-03, ARCHITECTURE §6.6): data/files/<householdId>/<fileId>. Путь строит сервер
// из двух uuid-брендов — имя и путь из запроса не используются; id проверяются и во время выполнения (бренд — только
// тип), поэтому «../» и вложенные папки отвергаются до обращения к диску. Запись — во временный файл и rename: файл
// либо целый, либо его нет. Права: папки 0700, файлы 0600. Кто владелец файла, проверяет модуль через s (БД) до
// вызова. В тестах — MemoryBlobStore из @kosht/testing с тем же поведением.
import { FileId, HouseholdId } from "@kosht/kernel";
import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface BlobStore {
  /** Записать файл целиком (существующий заменяется). */
  put(householdId: HouseholdId, fileId: FileId, data: Uint8Array): Promise<void>;
  /**
   * Записать файл из потока кусков (архив «Мои данные», PRIV-05): в памяти — только текущий кусок. Возвращает размер
   * в байтах; поток оборвался — файла нет (ни целого, ни части).
   */
  putStream(
    householdId: HouseholdId,
    fileId: FileId,
    source: AsyncIterable<Uint8Array>,
  ): Promise<number>;
  /** Содержимое или undefined, если файла нет. */
  get(householdId: HouseholdId, fileId: FileId): Promise<Uint8Array | undefined>;
  /** Файл как Blob для выдачи по HTTP (содержимое читается при отправке, а не заранее); нет — undefined. */
  open(householdId: HouseholdId, fileId: FileId): Promise<Blob | undefined>;
  /** Удалить файл; его отсутствие — не ошибка. */
  delete(householdId: HouseholdId, fileId: FileId): Promise<void>;
  /** Удалить все файлы домохозяйства (удаление аккаунта, PRIV-06). */
  deleteHousehold(householdId: HouseholdId): Promise<void>;
}

/** Хранилище на диске; root — <DATA_DIR>/files. */
export function createLocalFsBlobStore(root: string): BlobStore {
  const base = resolve(root);

  /** Путь внутри root: оба id — uuid (иначе RangeError), итог ещё раз сверяется с root. */
  function pathOf(householdId: string, fileId?: string): string {
    const parts = [checked(HouseholdId, householdId, "householdId")];
    if (fileId !== undefined) parts.push(checked(FileId, fileId, "fileId"));
    const path = resolve(base, ...parts);
    if (!path.startsWith(base + sep)) throw new RangeError("Путь файла вне хранилища.");
    return path;
  }

  return {
    async put(householdId, fileId, data) {
      await write(pathOf(householdId, fileId), (chunk) => chunk(data));
    },
    async putStream(householdId, fileId, source) {
      let size = 0;
      await write(pathOf(householdId, fileId), async (chunk) => {
        for await (const part of source) {
          await chunk(part);
          size += part.byteLength;
        }
      });
      return size;
    },
    async get(householdId, fileId) {
      try {
        return new Uint8Array(await readFile(pathOf(householdId, fileId)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async open(householdId, fileId) {
      try {
        return await openAsBlob(pathOf(householdId, fileId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async delete(householdId, fileId) {
      await rm(pathOf(householdId, fileId), { force: true });
    },
    async deleteHousehold(householdId) {
      await rm(pathOf(householdId), { recursive: true, force: true });
    },
  };
}

/** Запись во временный файл рядом и rename: файл либо целый, либо его нет (в том числе при обрыве потока). */
async function write(
  path: string,
  fill: (chunk: (data: Uint8Array) => Promise<void>) => Promise<void>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await fill(async (data) => {
        await handle.write(data);
      });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function checked(schema: typeof HouseholdId | typeof FileId, value: string, name: string): string {
  if (!schema.safeParse(value).success) {
    throw new RangeError(`${name}: ожидается uuid — путь из запроса в хранилище не попадает.`);
  }
  return value;
}
