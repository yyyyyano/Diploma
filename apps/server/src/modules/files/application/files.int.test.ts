// SEC-03, PRIV-05, PRIV-06 на Postgres: файл пишется по пути из id (имя — только метаданные), выдаётся только своему
// домохозяйству (чужой id — NOT_FOUND), уходит в архив «Мои данные» (кроме прежних архивов) и удаляется с каталогом.
import { FakeClock, MemoryBlobStore, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { FileKind } from "../domain/file-kind.ts";
import { makeFiles } from "./files.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function setup() {
  const blobs = new MemoryBlobStore();
  const files = makeFiles({
    blobs,
    clock: new FakeClock("2026-10-26T09:00:00Z"),
    log: memoryLogger().log,
  });
  return { blobs, files };
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = async (blob: Blob) => blob.text();

describe("SEC-03: файл домохозяйства", () => {
  it("сохраняется с очищенным именем и выдаётся владельцу с типом и размером", async () => {
    const { files } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    const saved = await files.save(s, {
      kind: "statement",
      name: "../../Выписка.csv",
      mime: "text/csv",
      content: bytes("дата;сумма"),
    });
    const opened = await files.open(s, saved.id);
    expect(opened).toMatchObject({
      id: saved.id,
      kind: "statement",
      name: "Выписка.csv",
      mime: "text/csv",
      size: bytes("дата;сумма").byteLength,
      createdAt: new Date("2026-10-26T09:00:00Z"),
    });
    expect(await text(opened.blob)).toBe("дата;сумма");
  });

  it("поток кусков сохраняется целиком, размер — сумма кусков", async () => {
    const { files } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 2, household: 2 }));
    async function* chunks() {
      yield bytes("PK");
      yield bytes("…архив");
    }
    const saved = await files.save(s, {
      kind: "data-export",
      name: "kosht.zip",
      mime: "application/zip",
      content: chunks(),
    });
    expect(saved.size).toBe(bytes("PK…архив").byteLength);
    expect(await text((await files.open(s, saved.id)).blob)).toBe("PK…архив");
  });

  it("чужое домохозяйство по id файла получает NOT_FOUND, файл не тронут", async () => {
    const { files } = setup();
    const owner = createScopedDb(db.pool, testScope({ user: 3, household: 3 }));
    const stranger = createScopedDb(db.pool, testScope({ user: 4, household: 4 }));
    const saved = await files.save(owner, {
      kind: "receipt-photo",
      name: "чек.jpg",
      mime: "image/jpeg",
      content: bytes("jpeg"),
    });
    await expect(files.open(stranger, saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await files.remove(stranger, saved.id);
    expect(await text((await files.open(owner, saved.id)).blob)).toBe("jpeg");
  });

  it("строка не записалась — файла в хранилище тоже нет", async () => {
    const { files, blobs } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 5, household: 5 }));
    await expect(
      files.save(s, {
        kind: "unknown" as FileKind,
        name: "x.bin",
        mime: "application/octet-stream",
        content: bytes("x"),
      }),
    ).rejects.toThrow(/files_kind_check|Failed query/);
    expect(blobs.size).toBe(0);
  });

  it("remove удаляет строку и файл; повтор — без ошибки, затем NOT_FOUND", async () => {
    const { files, blobs } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 6, household: 6 }));
    const saved = await files.save(s, {
      kind: "receipt-photo",
      name: "чек.jpg",
      mime: "image/jpeg",
      content: bytes("jpeg"),
    });
    await files.remove(s, saved.id);
    await files.remove(s, saved.id);
    expect(blobs.size).toBe(0);
    await expect(files.open(s, saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PRIV-05, PRIV-06: файлы в «Мои данные» и при удалении аккаунта", () => {
  it("в архив — исходные файлы «<id>-<имя>», прежний архив — нет", async () => {
    const { files } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 7, household: 7 }));
    const photo = await files.save(s, {
      kind: "receipt-photo",
      name: "чек.jpg",
      mime: "image/jpeg",
      content: bytes("jpeg"),
    });
    await files.save(s, {
      kind: "data-export",
      name: "kosht.zip",
      mime: "application/zip",
      content: bytes("zip"),
    });
    const added: [string, string][] = [];
    await files.exportFiles(s, {
      file: async (path, data) => {
        added.push([path, new TextDecoder().decode(data)]);
      },
    });
    expect(added).toEqual([[`${photo.id}-чек.jpg`, "jpeg"]]);
  });

  it("removeHousehold удаляет каталог своего домохозяйства, чужие файлы остаются", async () => {
    const { files, blobs } = setup();
    const scopeA = testScope({ user: 8, household: 8 });
    const scopeB = testScope({ user: 9, household: 9 });
    const file = {
      kind: "statement" as const,
      name: "a.csv",
      mime: "text/csv",
      content: bytes("a"),
    };
    await files.save(createScopedDb(db.pool, scopeA), file);
    const kept = await files.save(createScopedDb(db.pool, scopeB), file);
    await files.removeHousehold(scopeA);
    expect(blobs.size).toBe(1);
    expect(await text((await files.open(createScopedDb(db.pool, scopeB), kept.id)).blob)).toBe("a");
  });
});
