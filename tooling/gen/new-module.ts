// make new-module id=<id>: заготовка модуля сервера из карты tooling/architecture/modules.ts (ARCHITECTURE §4.1):
// apps/server/src/modules/<id>/{CLAUDE.md, index.ts, module.ts} и пересборка main/create-modules.ts (все модули с
// папками — в порядке топологической сортировки). Модуль должен быть в карте, его зависимости — уже созданы, а
// папка — ещё нет: готовый паспорт и код генератор не перезаписывает.
//   node tooling/gen/new-module.ts <id>
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, type ModuleDef } from "../architecture/modules.ts";
import { renderCreateModules, renderIndex, renderModule, renderPassport } from "./module-files.ts";
import { topologicalOrder } from "./module-order.ts";

export const MODULES_DIR = "apps/server/src/modules";
export const CREATE_MODULES = "apps/server/src/main/create-modules.ts";

export interface GenResult {
  readonly code: 0 | 1;
  /** Созданные или изменённые файлы относительно корня. */
  readonly files: readonly string[];
  readonly messages: readonly string[];
}

function created(root: string, id: string): boolean {
  return existsSync(join(root, MODULES_DIR, id, "module.ts"));
}

export function runNewModule(options: {
  readonly root: string;
  readonly id: string;
  readonly modules?: readonly ModuleDef[];
}): GenResult {
  const { root, id } = options;
  const modules = options.modules ?? MODULES;
  const m = modules.find((candidate) => candidate.id === id);
  if (m === undefined) {
    return {
      code: 1,
      files: [],
      messages: [
        `Модуля «${id}» нет в tooling/architecture/modules.ts: сначала добавьте его в карту (ярус, dependsOn, ` +
          "tables) с обоснованием в итоге задачи, затем make capabilities.",
      ],
    };
  }
  const dir = join(MODULES_DIR, id);
  if (existsSync(join(root, dir))) {
    return {
      code: 1,
      files: [],
      messages: [`${dir} уже есть: генератор не перезаписывает модуль.`],
    };
  }
  const missing = m.dependsOn.filter((dep) => !created(root, dep));
  if (missing.length > 0) {
    return {
      code: 1,
      files: [],
      messages: [
        `Модуль ${id} зависит от ещё не созданных: ${missing.join(", ")} — сначала make new-module для них.`,
      ],
    };
  }
  mkdirSync(join(root, dir), { recursive: true });
  const files: [string, string][] = [
    [join(dir, "CLAUDE.md"), renderPassport(m)],
    [join(dir, "index.ts"), renderIndex(m)],
    [join(dir, "module.ts"), renderModule(m)],
  ];
  for (const [path, text] of files) writeFileSync(join(root, path), text);
  const ordered = topologicalOrder(modules).filter((x) => created(root, x.id));
  mkdirSync(join(root, dirname(CREATE_MODULES)), { recursive: true });
  writeFileSync(join(root, CREATE_MODULES), renderCreateModules(ordered));
  return {
    code: 0,
    files: [...files.map(([path]) => path), CREATE_MODULES],
    messages: [
      `Создан модуль ${id}: паспорт, index.ts, module.ts; корень композиции пересобран (${String(ordered.length)} мод.).`,
      "Дальше: паспорт дополняет задача модуля; таблицы — make new-table module=… name=….",
    ],
  };
}

function main(): number {
  const id = process.argv[2] ?? "";
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = runNewModule({ root, id });
  for (const message of result.messages) {
    if (result.code === 0) console.log(message);
    else console.error(message);
  }
  return result.code;
}

if (import.meta.main) process.exitCode = main();
