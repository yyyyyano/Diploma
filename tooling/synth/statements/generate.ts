// Генератор синтетических выписок (T-025): `make synth-statements` → datasets/statements/<случай>/statement.<ext> +
// expected.json и README.md с происхождением. Реальных выписок нет (NFR-18): банки, счета и продавцы вымышлены.
// Результат повторяем бит в бит (зерно в ledger.ts, фиксированные даты в файлах).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCases } from "./cases.ts";

const root = fileURLToPath(new URL("../../../datasets/statements/", import.meta.url));

export async function writeDataset(dir: string = root): Promise<string[]> {
  rmSync(dir, { recursive: true, force: true });
  const cases = await generateCases();
  const readme = [
    "# Синтетические выписки",
    "",
    "Сгенерированы `tooling/synth/statements/` (`make synth-statements`). Банки, счета, продавцы и суммы вымышлены,",
    "реальных выписок и персональных данных здесь нет (NFR-18). Файл случая — `statement.<ext>`, эталон —",
    "`expected.json`: операции, остатки, расхождение цепочки остатков и смысл колонок. Генератор детерминирован:",
    "повторный запуск даёт те же байты (проверяет `tooling/synth/statements/generate.test.ts`).",
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
  process.stdout.write(`Сгенерировано случаев: ${ids.length} (${dirname(root)}/statements)\n`);
}
