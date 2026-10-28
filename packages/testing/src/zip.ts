// Чтение ZIP-архива в тестах (архив «Мои данные», PRIV-05): записи и их содержимое из байтов архива. yauzl — тот же
// автор, что у yazl, которым архив пишет сервер; боевому коду он не нужен.
import { fromBuffer, type Entry, type ZipFile } from "yauzl";

/** Записи архива: путь → содержимое; повторный путь — ошибка (в архиве «Мои данные» их не бывает). */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, file) => {
      if (error !== null) reject(error);
      else resolve(file);
    });
  });
  const entries = new Map<string, Uint8Array>();
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", () => resolve());
    zip.on("entry", (entry: Entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error !== null) {
          reject(error);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => {
          if (entries.has(entry.fileName)) {
            reject(new Error(`Запись ${entry.fileName} в архиве дважды.`));
            return;
          }
          entries.set(entry.fileName, new Uint8Array(Buffer.concat(chunks)));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
  return entries;
}
