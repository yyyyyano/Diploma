// ZIP-архив «Мои данные» (PRIV-05, ADR-0012): yazl 3 пишет архив потоком — записи добавляются по одной, а наружу
// выходит поток байтов, который files сохраняет на диск кусками (BlobStore.putStream). Источники записей (Blob файла,
// поток JSON таблицы) открываются лениво — только когда до них дошла запись, поэтому в памяти не лежат все фото и все
// строки сразу. Ошибка сборки — abort: поток вывода обрывается с этой ошибкой, и недописанный файл не сохраняется.
// yazl соединяет источник с архивом через pipe, а pipe ошибку источника дальше не передаёт — без своего обработчика
// оборванный источник (файл удалили во время сборки, запрос к базе упал) оставил бы архив висеть навсегда.
import { Readable } from "node:stream";
import { ZipFile } from "yazl";

export interface ArchiveWriter {
  /** Запись целиком из памяти. */
  addBuffer(path: string, data: Uint8Array): void;
  /** Запись из Blob (исходный файл): читается потоком в свою очередь. */
  addBlob(path: string, blob: Blob): void;
  /** Запись из потока кусков (JSON таблицы по страницам): источник создаётся, когда до записи дошла очередь. */
  addStream(path: string, source: () => AsyncIterable<Uint8Array>): void;
  /** Байты архива по мере сборки. */
  readonly output: AsyncIterable<Uint8Array>;
  /** Больше записей не будет: архив дописывается и поток закрывается. */
  end(): void;
  /** Сборка не удалась: поток вывода обрывается с ошибкой. */
  abort(error: unknown): void;
}

export function createZipArchive(at: Date): ArchiveWriter {
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  const abort = (error: unknown) => {
    output.destroy(error instanceof Error ? error : new Error("Сборка архива прервана."));
  };
  zip.on("error", abort);
  const addLazy = (path: string, open: () => Readable, size?: number) => {
    zip.addReadStreamLazy(path, { mtime: at, ...(size === undefined ? {} : { size }) }, (done) => {
      const stream = open();
      stream.on("error", abort);
      done(null, stream);
    });
  };
  return {
    addBuffer(path, data) {
      zip.addBuffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength), path, {
        mtime: at,
      });
    },
    addBlob(path, blob) {
      addLazy(path, () => Readable.fromWeb(blob.stream()), blob.size);
    },
    addStream(path, source) {
      addLazy(path, () => Readable.from(source(), { objectMode: false }));
    },
    output,
    end() {
      zip.end();
    },
    abort,
  };
}
