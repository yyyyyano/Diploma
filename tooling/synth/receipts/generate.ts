// Генератор синтетических чеков (T-027): `make synth-receipts` → datasets/receipts/<случай>/receipt.<ext> +
// expected.json и README.md с происхождением. Реальных чеков нет (NFR-18): магазины, УНП, адреса и УИ вымышлены.
// Результат повторяем бит в бит (зерно у каждого случая, фиксированные размеры).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCases } from "./cases.ts";

const root = fileURLToPath(new URL("../../../datasets/receipts/", import.meta.url));

export async function writeDataset(dir: string = root): Promise<string[]> {
  rmSync(dir, { recursive: true, force: true });
  const cases = await generateCases();
  const readme = [
    "# Синтетические чеки",
    "",
    "Сгенерированы `tooling/synth/receipts/` (`make synth-receipts`). Магазины, УНП, адреса, товары, суммы и УИ вымышлены,",
    "реальных чеков и персональных данных здесь нет (NFR-18). Файл случая — `receipt.<ext>`, эталон — `expected.json`:",
    "что напечатано на чеке (позиции, скидки, итог, оплата, УИ), читается ли QR с фото и какие расхождения арифметики",
    "должен найти валидатор. Генератор детерминирован: повторный запуск даёт те же байты (`generate.test.ts`).",
    "Содержимое QR — ссылка с УИ из 24 символов; настоящий формат QR белорусских чеков не проверялся (образца нет), поэтому",
    "приложение ищет в QR группу из 24 букв и цифр, а не разбирает ссылку по шаблону.",
    "HEIC собирается через ffmpeg с libx265 (`heic.ts`): свободного образца нет, кодировщика HEIC в npm тоже.",
    "",
    "| Случай | Что проверяет |",
    "|---|---|",
  ];
  const written: string[] = [];
  for (const item of cases) {
    const folder = join(dir, item.id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, item.file.name), item.file.bytes);
    writeFileSync(join(folder, "expected.json"), `${JSON.stringify(item.expected, null, 2)}\n`);
    readme.push(`| \`${item.id}\` | ${item.expected.origin} |`);
    written.push(item.id);
  }
  writeFileSync(join(dir, "README.md"), `${readme.join("\n")}\n`);
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ids = await writeDataset();
  process.stdout.write(`Сгенерировано случаев: ${ids.length} (datasets/receipts)\n`);
}
