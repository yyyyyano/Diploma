import { FileId, HouseholdId } from "@kosht/kernel";
import { MemoryBlobStore, testHouseholdId } from "@kosht/testing";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLocalFsBlobStore, type BlobStore } from "./blob-store.ts";

const root = mkdtempSync(join(tmpdir(), "kosht-files-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const A = testHouseholdId(1);
const B = testHouseholdId(2);
const file = (n: number) => FileId.parse(`0199f2a4-0000-7000-8000-${String(n).padStart(12, "0")}`);
const bytes = (text: string) => new TextEncoder().encode(text);

// Одни проверки для хранилища на диске и для MemoryBlobStore из @kosht/testing: поведение у них одинаковое.
// Присваивание типу BlobStore — заодно проверка, что форма MemoryBlobStore совпадает с интерфейсом.
const memory: BlobStore = new MemoryBlobStore();
const stores: [string, BlobStore][] = [
  ["local-fs", createLocalFsBlobStore(join(root, "files"))],
  ["MemoryBlobStore", memory],
];

describe.each(stores)("SEC-03: хранилище файлов (%s)", (_name, store) => {
  it("записывает, читает и заменяет файл", async () => {
    await store.put(A, file(1), bytes("чек 1"));
    expect(new TextDecoder().decode(await store.get(A, file(1)))).toBe("чек 1");
    await store.put(A, file(1), bytes("чек 1, v2"));
    expect(new TextDecoder().decode(await store.get(A, file(1)))).toBe("чек 1, v2");
  });

  it("нет файла — undefined; файл другого домохозяйства с тем же id не виден", async () => {
    await store.put(A, file(2), bytes("A"));
    expect(await store.get(B, file(2))).toBeUndefined();
    expect(await store.get(A, file(99))).toBeUndefined();
  });

  it("правка прочитанного или записанного массива не меняет файл", async () => {
    const data = bytes("исходный");
    await store.put(A, file(3), data);
    data.fill(0);
    const read = await store.get(A, file(3));
    read?.fill(0);
    expect(new TextDecoder().decode(await store.get(A, file(3)))).toBe("исходный");
  });

  it("delete удаляет файл, повторный delete — не ошибка", async () => {
    await store.put(A, file(4), bytes("x"));
    await store.delete(A, file(4));
    await store.delete(A, file(4));
    expect(await store.get(A, file(4))).toBeUndefined();
  });

  it("deleteHousehold удаляет файлы только этого домохозяйства", async () => {
    await store.put(A, file(5), bytes("A"));
    await store.put(B, file(5), bytes("B"));
    await store.deleteHousehold(A);
    expect(await store.get(A, file(5))).toBeUndefined();
    expect(new TextDecoder().decode(await store.get(B, file(5)))).toBe("B");
  });

  it.each([
    ["../../etc", "0199f2a4-0000-7000-8000-000000000001"],
    ["0199f2a4-0000-7000-8000-000000000001", "../passwd"],
    ["0199f2a4-0000-7000-8000-000000000001", "a/b"],
    ["", "0199f2a4-0000-7000-8000-000000000001"],
  ])("путь из запроса (%s, %s) отвергается до обращения к диску", async (household, id) => {
    const forgedHousehold = household as HouseholdId;
    const forgedFile = id as FileId;
    await expect(store.put(forgedHousehold, forgedFile, bytes("x"))).rejects.toThrow(
      /ожидается uuid/,
    );
    await expect(store.get(forgedHousehold, forgedFile)).rejects.toThrow(/ожидается uuid/);
    await expect(store.delete(forgedHousehold, forgedFile)).rejects.toThrow(/ожидается uuid/);
  });
});

describe.each(stores)("SEC-03: удаление домохозяйства по поддельному id (%s)", (_n, store) => {
  it("«../..» вместо householdId отвергается — каталог выше хранилища не удалить", async () => {
    await expect(store.deleteHousehold("../.." as HouseholdId)).rejects.toThrow(/ожидается uuid/);
  });
});

describe("local-fs: файлы на диске", () => {
  const files = join(root, "disk");
  const store = createLocalFsBlobStore(files);

  it("путь data/files/<householdId>/<fileId>, файл 0600, папка 0700, временных файлов нет", async () => {
    await store.put(A, file(10), bytes("фото чека"));
    expect(readdirSync(join(files, A))).toEqual([file(10)]);
    expect(statSync(join(files, A, file(10))).mode & 0o777).toBe(0o600);
    expect(statSync(join(files, A)).mode & 0o777).toBe(0o700);
  });
});
