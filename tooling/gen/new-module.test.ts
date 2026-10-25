// make new-module (ARCHITECTURE §4.1, §13 шаг 5): заготовка модуля и корень композиции — только из карты
// modules.ts. Генератор работает во временной папке, а не в репозитории.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleDef } from "../architecture/modules.ts";
import { camel, pascal, renderModule, renderPassport } from "./module-files.ts";
import { CREATE_MODULES, MODULES_DIR, runNewModule } from "./new-module.ts";

function def(id: string, extra: Partial<ModuleDef> = {}): ModuleDef {
  return {
    id,
    tier: 1,
    spec: "RCPT-01…15",
    responsibility: "чеки: QR, распознавание",
    dependsOn: [],
    tables: [],
    publishes: [],
    ...extra,
  };
}

const mail = def("mail", { tables: ["system"] });
const files = def("files", { tables: ["user"] });
const legalBase = def("legal-base", { tier: 2, dependsOn: ["mail", "files"], tables: ["public"] });
const MAP = [legalBase, mail, files];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kosht-new-module-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("имена из id", () => {
  it("kebab-case → camelCase для ключей и PascalCase для типов", () => {
    expect([camel("legal-base"), pascal("legal-base"), pascal("files")]).toEqual([
      "legalBase",
      "LegalBase",
      "Files",
    ]);
  });
});

describe("make new-module", () => {
  it("модуля нет в карте — отказ с подсказкой править modules.ts", () => {
    const result = runNewModule({ root, id: "ghost", modules: MAP });
    expect(result.code).toBe(1);
    expect(result.messages.join("\n")).toContain("modules.ts");
  });

  it("зависимости ещё не созданы — отказ с их списком", () => {
    const result = runNewModule({ root, id: "legal-base", modules: MAP });
    expect(result).toMatchObject({ code: 1, files: [] });
    expect(result.messages.join("\n")).toContain("mail, files");
  });

  it("создаёт паспорт, index.ts и module.ts и пересобирает корень композиции по порядку карты", () => {
    for (const id of ["mail", "files", "legal-base"]) {
      expect(runNewModule({ root, id, modules: MAP }).code).toBe(0);
    }
    expect(read(join(MODULES_DIR, "legal-base", "index.ts"))).toContain(
      'export { createLegalBaseModule, type LegalBaseFacade, type LegalBaseFacades } from "./module.ts";',
    );
    const wiring = read(CREATE_MODULES);
    // Порядок — топологический: mail и files раньше legal-base, хотя в карте legal-base первый.
    expect([...wiring.matchAll(/const (\w+)Module = /g)].map((match) => match[1])).toEqual([
      "mail",
      "files",
      "legalBase",
    ]);
    expect(wiring).toContain("facades: { mail: mailModule.facade, files: filesModule.facade },");
  });

  it("существующий модуль не перезаписывается", () => {
    runNewModule({ root, id: "mail", modules: MAP });
    const result = runNewModule({ root, id: "mail", modules: MAP });
    expect(result.code).toBe(1);
    expect(result.messages.join("\n")).toContain("не перезаписывает");
  });
});

describe("module.ts: подпись фабрики create<Id>Module({ platform, facades })", () => {
  it("фасады — ровно dependsOn, платформа с SystemDb — при таблицах system/public", () => {
    const text = renderModule(legalBase);
    expect(text).toContain("readonly mail: MailFacade;");
    expect(text).toContain("readonly files: FilesFacade;");
    expect(text).toContain(
      "export function createLegalBaseModule(_deps: ModuleDeps<LegalBaseFacades, SystemPlatform>) {",
    );
    expect(text).toContain('return defineModule({ id: "legal-base" });');
  });

  it("модуль только с пользовательскими таблицами SystemDb не получает", () => {
    expect(renderModule(files)).toContain("ModuleDeps<FilesFacades, Platform>");
    expect(renderModule(files)).toContain("export type FilesFacades = NoFacades;");
  });
});

describe("паспорт из карты", () => {
  it("ярус, зависимости, требования и запреты по видам таблиц; не длиннее 60 строк", () => {
    const text = renderPassport(legalBase);
    expect(text).toContain("Ярус 2 · таблицы: public");
    expect(text).toContain("Можно: mail, files (`tooling/architecture/modules.ts`).");
    expect(text).toContain("RCPT-01…15.");
    expect(text).toContain("`SystemDb` — только для своих таблиц");
    expect(text.split("\n").length).toBeLessThanOrEqual(60);
  });

  it("модуль без зависимостей и таблиц — прочерки и запрет своих таблиц", () => {
    const text = renderPassport(def("dashboard", { tier: 3 }));
    expect(text).toContain("Можно: — (`tooling/architecture/modules.ts`).");
    expect(text).toContain("Своих таблиц нет");
  });
});
