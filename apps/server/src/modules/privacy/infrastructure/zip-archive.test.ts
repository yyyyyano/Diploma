// PRIV-05: архив пишется потоком — записи из памяти и из Blob читаются обратно как были; сборка оборвалась — поток
// вывода падает с этой ошибкой (недописанный архив не сохранится).
import { readZip } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { createZipArchive } from "./zip-archive.ts";

async function collect(output: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of output) parts.push(part);
  return new Uint8Array(Buffer.concat(parts));
}

const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data);

describe("PRIV-05: потоковый ZIP", () => {
  it("записи из памяти и из Blob с кириллицей в пути читаются обратно", async () => {
    const archive = createZipArchive(new Date("2026-10-27T09:00:00Z"));
    const bytes = collect(archive.output);
    archive.addBuffer("data/accounts/accounts.json", new TextEncoder().encode('[{"kind":"cash"}]'));
    archive.addBlob("files/files/чек.jpg", new Blob([new TextEncoder().encode("jpeg-байты")]));
    archive.end();
    const entries = await readZip(await bytes);
    expect([...entries.keys()]).toEqual(["data/accounts/accounts.json", "files/files/чек.jpg"]);
    expect(text(entries.get("data/accounts/accounts.json"))).toBe('[{"kind":"cash"}]');
    expect(text(entries.get("files/files/чек.jpg"))).toBe("jpeg-байты");
  });

  it("запись из потока кусков открывается лениво и читается обратно целиком", async () => {
    const archive = createZipArchive(new Date("2026-10-27T09:00:00Z"));
    const opened: string[] = [];
    const bytes = collect(archive.output);
    archive.addStream("data/a.json", async function* () {
      opened.push("a");
      yield new TextEncoder().encode("[\n");
      yield new TextEncoder().encode('{"id":1}');
      yield new TextEncoder().encode("\n]\n");
    });
    expect(opened).toEqual([]);
    archive.end();
    const entries = await readZip(await bytes);
    expect(opened).toEqual(["a"]);
    expect(text(entries.get("data/a.json"))).toBe('[\n{"id":1}\n]\n');
  });

  it("источник записи оборвался посередине — поток вывода падает той же ошибкой, а не висит", async () => {
    const archive = createZipArchive(new Date("2026-10-27T09:00:00Z"));
    const bytes = collect(archive.output);
    archive.addStream("data/a.json", async function* () {
      yield new TextEncoder().encode("[");
      throw new Error("запрос к базе упал");
    });
    archive.end();
    await expect(bytes).rejects.toThrow("запрос к базе упал");
  });

  it("abort — поток вывода обрывается той же ошибкой", async () => {
    const archive = createZipArchive(new Date("2026-10-27T09:00:00Z"));
    const bytes = collect(archive.output);
    archive.addBuffer("a.json", new TextEncoder().encode("[]"));
    archive.abort(new Error("таблица не прочиталась"));
    await expect(bytes).rejects.toThrow("таблица не прочиталась");
  });
});
