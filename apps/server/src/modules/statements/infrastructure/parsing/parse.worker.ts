// Рабочий файл изолированного чтения выписки (SEC-03): выполняется в worker_thread под лимитами памяти и времени
// (platform/sandbox). Принимает тип по содержимому и байты, отдаёт сырую таблицу или картинки страниц. Любые
// библиотеки разбора недоверенных файлов (unpdf, SheetJS, papaparse, sharp) живут только здесь.
import { SandboxRejection } from "../../../../platform/sandbox/isolated.ts";
import { serveIsolated } from "../../../../platform/sandbox/serve.ts";
import type { RawDocument } from "../../domain/types.ts";
import { readCsv } from "./read-csv.ts";
import { readPdf } from "./read-pdf.ts";
import { readSheet } from "./read-sheet.ts";

/** Вход потока: тип по содержимому (его определил files) и байты. */
export interface ReadInput {
  readonly type: "pdf" | "xlsx" | "xls" | "csv" | "jpg" | "png" | "webp" | "heic";
  readonly bytes: Uint8Array;
}

const IMAGE_MIME = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
} as const;

serveIsolated(async ({ type, bytes }: ReadInput): Promise<RawDocument> => {
  switch (type) {
    case "csv": {
      const table = readCsv(bytes);
      if (table === null) throw new SandboxRejection("too-big");
      return { kind: "table", table };
    }
    case "xlsx":
    case "xls":
      return { kind: "table", table: readSheet(bytes, type) };
    case "pdf":
      return readPdf(bytes);
    default:
      // Фото выписки — это сразу картинка для модели.
      return { kind: "images", images: [{ bytes, mime: IMAGE_MIME[type] }] };
  }
});
