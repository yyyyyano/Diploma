// LegalSource из сохранённых страниц (NFR-11): тесты и стенд e2e не ходят в сеть. Папка — настройка
// `legal-base.fixtures-dir` (в стенде — `__fixtures__/pravo-by`); страница акта — файл `<ID>.html`, нет файла — у акта
// нет текста, как 404 на pravo.by.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ActTextNotFound,
  type LegalSource,
  type RegistrySource,
  type SourcePage,
} from "../../application/ports.ts";
import { PRAVO_ID } from "./pravo-source.ts";

export function createFixturesSource(deps: {
  readonly dir: () => Promise<string>;
  readonly now: () => Date;
}): LegalSource & RegistrySource {
  async function read(name: string): Promise<string> {
    try {
      return await readFile(join(await deps.dir(), name), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new ActTextNotFound();
      }
      throw error;
    }
  }
  const check = (pravoId: string): void => {
    if (!PRAVO_ID.test(pravoId)) throw new RangeError("ID акта pravo.by не по правилу реквизитов.");
  };
  return {
    async fetchActText(pravoId): Promise<SourcePage> {
      check(pravoId);
      return { html: await read(`${pravoId}.html`), fetchedAt: deps.now() };
    },
    async fetchActCard(pravoId): Promise<SourcePage> {
      check(pravoId);
      return { html: await read(`card-${pravoId}.html`), fetchedAt: deps.now() };
    },
    async headActText(pravoId) {
      check(pravoId);
      try {
        return { contentLength: (await stat(join(await deps.dir(), `${pravoId}.html`))).size };
      } catch {
        throw new ActTextNotFound();
      }
    },
  };
}
