// Вызывающий код для проверки сборки (prepare-photo.build.test.ts): готовит фото из argv так, как это делает бандл worker
// в образе, и печатает «тип размер_копии коды».
import { readFileSync } from "node:fs";
import { makePhotoPreparer } from "../prepare-photo.ts";

const [path, type] = process.argv.slice(2);
if (path === undefined || type === undefined) throw new Error("нужны путь и тип фото");
const prepared = await makePhotoPreparer(async () => ({
  timeoutMs: 60_000,
  memoryMb: 1_024,
})).prepare({
  type: type as "jpg" | "png" | "webp" | "heic",
  bytes: new Uint8Array(readFileSync(path)),
  maxSide: 2_000,
});
process.stdout.write(`${prepared.mime} codes:${prepared.codes.length}\n`);
