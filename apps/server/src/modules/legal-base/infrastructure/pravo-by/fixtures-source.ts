// LegalSource из сохранённых страниц (NFR-11): тесты и стенд e2e не ходят в сеть. Папка — настройка
// `legal-base.fixtures-dir` (в стенде — `__fixtures__/pravo-by`); страница акта — файл `<ID>.html`, нет файла — у акта
// нет текста, как 404 на pravo.by.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ActTextNotFound, type LegalSource } from "../../application/ports.ts";
import { PRAVO_ID } from "./pravo-source.ts";

export function createFixturesSource(deps: {
  readonly dir: () => Promise<string>;
  readonly now: () => Date;
}): LegalSource {
  return {
    async fetchActText(pravoId) {
      if (!PRAVO_ID.test(pravoId))
        throw new RangeError("ID акта pravo.by не по правилу реквизитов.");
      try {
        const html = await readFile(join(await deps.dir(), `${pravoId}.html`), "utf8");
        return { html, fetchedAt: deps.now() };
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          throw new ActTextNotFound();
        }
        throw error;
      }
    },
  };
}
