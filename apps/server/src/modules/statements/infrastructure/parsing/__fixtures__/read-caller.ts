// Вызывающий код для проверки сборки (read-document.build.test.ts): читает файл из argv через readDocument — так, как это
// делает бандл worker в образе, — и печатает число строк таблицы или число картинок.
import { readFileSync } from "node:fs";
import { readDocument } from "../read-document.ts";

const [path, type] = process.argv.slice(2);
if (path === undefined || type === undefined) throw new Error("нужны путь и тип файла");
const document = await readDocument(
  { type: type as "csv" | "pdf" | "xlsx" | "xls", bytes: new Uint8Array(readFileSync(path)) },
  { timeoutMs: 30_000, memoryMb: 512 },
);
process.stdout.write(
  document.kind === "table"
    ? `table:${document.table.lines.length}\n`
    : `images:${document.images.length}\n`,
);
