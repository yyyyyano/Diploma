// Стили экранов берут цвета, отступы и радиусы только из токенов (design/tokens.css → tokens.css, kit.css). Ссылка на
// несуществующий токен молча даёт значение по умолчанию: рамка и скругление пропадают, «приглушённый» текст становится
// обычным — так «Чеки и документы» разошлись с макетом. Тест ловит var(--x), которого нигде не объявлено.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Папка src сайта; import.meta.dirname, а не URL: URL окружения jsdom — не URL Node.
const SRC = join(import.meta.dirname, "../../");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("DES-01: токены в стилях", () => {
  it("каждый var(--x) в стилях сайта объявлен в токенах или в самом стиле", () => {
    const files = cssFiles(SRC);
    const texts = files.map((file) => readFileSync(file, "utf8"));
    const declared = new Set(
      texts.flatMap((text) => [...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])),
    );
    const missing = files.flatMap((file, index) =>
      [...(texts[index] ?? "").matchAll(/var\((--[\w-]+)/g)]
        .map((m) => m[1] ?? "")
        .filter((name) => !name.startsWith("--mantine-") && !declared.has(name))
        .map((name) => `${file.slice(SRC.length)}: ${name}`),
    );
    expect(files.length).toBeGreaterThan(10);
    expect([...new Set(missing)]).toEqual([]);
  });
});
