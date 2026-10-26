// Хранилище файлов в памяти для тестов (.claude/rules/testing.md): то же поведение, что у local-fs хранилища
// сервера (apps/server/src/platform/blob-store), — тест blob-store.test.ts гоняет оба одним набором проверок.
// Интерфейс BlobStore объявлен на сервере; пакет тестов сервер не импортирует, поэтому совпадение формы проверяет
// присваивание в том тесте.
import { FileId, HouseholdId } from "@kosht/kernel";

export class MemoryBlobStore {
  readonly #files = new Map<string, Uint8Array>();

  async put(householdId: HouseholdId, fileId: FileId, data: Uint8Array): Promise<void> {
    this.#files.set(key(householdId, fileId), Uint8Array.from(data));
  }

  async putStream(
    householdId: HouseholdId,
    fileId: FileId,
    source: AsyncIterable<Uint8Array>,
  ): Promise<number> {
    const target = key(householdId, fileId);
    const parts: Uint8Array[] = [];
    for await (const part of source) parts.push(Uint8Array.from(part));
    const data = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.byteLength;
    }
    this.#files.set(target, data);
    return data.byteLength;
  }

  async open(householdId: HouseholdId, fileId: FileId): Promise<Blob | undefined> {
    const data = this.#files.get(key(householdId, fileId));
    return data === undefined ? undefined : new Blob([Uint8Array.from(data)]);
  }

  async get(householdId: HouseholdId, fileId: FileId): Promise<Uint8Array | undefined> {
    const data = this.#files.get(key(householdId, fileId));
    return data === undefined ? undefined : Uint8Array.from(data);
  }

  async delete(householdId: HouseholdId, fileId: FileId): Promise<void> {
    this.#files.delete(key(householdId, fileId));
  }

  async deleteHousehold(householdId: HouseholdId): Promise<void> {
    const prefix = `${checked(HouseholdId, householdId, "householdId")}/`;
    // Удаление во время обхода Map безопасно: обход видит оставшиеся ключи.
    for (const name of this.#files.keys()) {
      if (name.startsWith(prefix)) this.#files.delete(name);
    }
  }

  /** Сколько файлов лежит (для утверждений теста). */
  get size(): number {
    return this.#files.size;
  }
}

function key(householdId: string, fileId: string): string {
  return `${checked(HouseholdId, householdId, "householdId")}/${checked(FileId, fileId, "fileId")}`;
}

function checked(schema: typeof HouseholdId | typeof FileId, value: string, name: string): string {
  if (!schema.safeParse(value).success) {
    throw new RangeError(`${name}: ожидается uuid — путь из запроса в хранилище не попадает.`);
  }
  return value;
}
