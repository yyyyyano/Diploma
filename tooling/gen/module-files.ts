// Заготовка модуля сервера из карты modules.ts (make new-module, ARCHITECTURE §4.1, docs/templates/module-passport.md):
// паспорт CLAUDE.md, index.ts (публичный API), module.ts (фабрика create<Id>Module с defineModule({ id })) и сборка
// всех модулей в корне композиции (main/create-modules.ts). Тексты — только из карты: ярус, требования,
// ответственность, зависимости, виды таблиц и события; паспорт потом дополняет задача модуля.
import type { ModuleDef } from "../architecture/modules.ts";

/** id → ключ фасада и ветки роутера: `legal-base` → `legalBase` (как moduleKey в platform/module). */
export function camel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_dash, letter: string) => letter.toUpperCase());
}

/** id → имя типа: `legal-base` → `LegalBase`. */
export function pascal(id: string): string {
  const key = camel(id);
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Модуль получает SystemPlatform (SystemDb), если у него есть таблицы system или public (ARCHITECTURE §6.5). */
function needsSystem(m: ModuleDef): boolean {
  return m.tables.includes("system") || m.tables.includes("public");
}

/** Перенос строки Markdown по словам, чтобы паспорт читался в редакторе (ширина — как у кода, ~118). */
function wrap(text: string, width = 118): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

function bullet(text: string): string[] {
  const [first = "", ...rest] = wrap(text, 116);
  return [`- ${first}`, ...rest.map((line) => `  ${line}`)];
}

function codeList(items: readonly string[]): string {
  return items.length === 0 ? "—" : items.map((item) => `\`${item}\``).join(", ");
}

function sentence(text: string): string {
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/** Строка «Можно: …» паспорта — тест сверяет её с dependsOn. */
export function passportDependsLine(m: ModuleDef): string {
  return `Можно: ${m.dependsOn.length === 0 ? "—" : m.dependsOn.join(", ")} (\`tooling/architecture/modules.ts\`).`;
}

export function renderPassport(m: ModuleDef): string {
  const factory = `create${pascal(m.id)}Module`;
  const platform = needsSystem(m)
    ? "`SystemPlatform` (с `system: SystemDb`)"
    : "`Platform` (без `SystemDb`)";
  const tables = m.tables.length === 0 ? "—" : m.tables.join(", ");
  const facades =
    m.dependsOn.length === 0
      ? "соседей нет (`NoFacades`)"
      : m.dependsOn.map((dep) => `\`facades.${camel(dep)}\``).join(", ");
  const bans = [
    "В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить " +
      "реализацию — реестром корня композиции (ADR-0004).",
    ...(m.tables.includes("user")
      ? [
          "Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая " +
            "таблица — `make new-table`, её строки — в `defineUserData` (`user-data.ts`).",
        ]
      : []),
    ...(needsSystem(m)
      ? [
          "`SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать " +
            "(аудитор SQL).",
        ]
      : []),
    ...(m.tables.length === 0
      ? ["Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей."]
      : []),
    "«Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.",
  ];
  const lines = [
    `# Модуль \`${m.id}\``,
    "",
    `Ярус ${String(m.tier)} · таблицы: ${tables} · публикует: ${codeList(m.publishes)} (\`docs/CAPABILITIES.md\`; задачи — \`tasks/plan.md\`)`,
    "",
    "## Назначение",
    ...wrap(
      `${sentence(m.responsibility)} Сейчас модуль пустой, но живой (T-007): фабрика, описание ` +
        `\`defineModule({ id: "${m.id}" })\` и место в корне композиции; содержимое добавляет задача модуля.`,
    ),
    "",
    "## Требования SPEC",
    ...wrap(`${m.spec}.`),
    "",
    "## Публичный API (`index.ts`)",
    ...bullet(
      `Фабрика: \`${factory}({ platform, facades })\` → \`defineModule({ id: "${m.id}" })\`; платформа — ${platform}; фасады — ${facades}.`,
    ),
    ...bullet(
      `Фасад \`${pascal(m.id)}Facade\` — пока нет (\`undefined\`); появится с первым сценарием, нужным соседям.`,
    ),
    ...bullet(
      `События (\`events.ts\`): ${codeList(m.publishes)}; контракт, задачи, инструменты агента, отмена, владелец ` +
        "данных, настройки — добавляет задача модуля.",
    ),
    "",
    "## Зависимости",
    `${passportDependsLine(m)} Слушает: —.`,
    "",
    "## Запреты",
    ...bans.flatMap(bullet),
    "",
    "## Как тестировать",
    ...bullet(
      `\`pnpm vitest run apps/server/src/modules/${m.id}\` — unit и int (нужен \`make db-up\`); общий — \`make check\`.`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function renderIndex(m: ModuleDef): string {
  const name = pascal(m.id);
  return [
    `// Публичный API модуля ${m.id} (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.`,
    `export { create${name}Module, type ${name}Facade, type ${name}Facades } from "./module.ts";`,
    "",
  ].join("\n");
}

export function renderModule(m: ModuleDef): string {
  const name = pascal(m.id);
  const platformType = needsSystem(m) ? "SystemPlatform" : "Platform";
  const platformImports = [
    "defineModule",
    "type ModuleDeps",
    ...(m.dependsOn.length === 0 ? ["type NoFacades"] : []),
    `type ${platformType}`,
  ];
  const facadeImports = m.dependsOn.map(
    (dep) => `import type { ${pascal(dep)}Facade } from "../${dep}/index.ts";`,
  );
  const facades =
    m.dependsOn.length === 0
      ? [`export type ${name}Facades = NoFacades;`]
      : [
          `export interface ${name}Facades {`,
          ...m.dependsOn.map((dep) => `  readonly ${camel(dep)}: ${pascal(dep)}Facade;`),
          "}",
        ];
  return [
    `// Модуль ${m.id} (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.`,
    "// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.",
    `import { ${platformImports.join(", ")} } from "../../platform/module/define-module.ts";`,
    ...facadeImports,
    "",
    "/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */",
    ...facades,
    "",
    `export function create${name}Module(_deps: ModuleDeps<${name}Facades, ${platformType}>) {`,
    `  return defineModule({ id: "${m.id}" });`,
    "}",
    "",
    "/** Что модуль даёт соседям: пока ничего (undefined). */",
    `export type ${name}Facade = ReturnType<typeof create${name}Module>["facade"];`,
    "",
  ].join("\n");
}

/**
 * Корень композиции модулей: каждый модуль — после своих зависимостей (порядок передаёт вызывающий —
 * topologicalOrder), с фасадами ровно своих dependsOn и SystemPlatform только при таблицах system/public.
 */
export function renderCreateModules(ordered: readonly ModuleDef[]): string {
  const imports = ordered.map(
    (m) => `import { create${pascal(m.id)}Module } from "../modules/${m.id}/index.ts";`,
  );
  const calls = ordered.flatMap((m) => {
    const facades = m.dependsOn
      .map((dep) => `${camel(dep)}: ${camel(dep)}Module.facade`)
      .join(", ");
    return [
      `  const ${camel(m.id)}Module = create${pascal(m.id)}Module({`,
      `    platform: ports.${needsSystem(m) ? "systemPlatform" : "platform"},`,
      `    facades: {${facades === "" ? "" : ` ${facades} `}},`,
      "  });",
    ];
  });
  return [
    "// Сборка модулей корня композиции (ARCHITECTURE §3): порядок — топологическая сортировка",
    "// tooling/architecture/modules.ts, фасады — ровно dependsOn модуля, SystemPlatform (с SystemDb) — только модулям с",
    "// таблицами system/public. Файл генерирует make new-module — руками не править; сверку с картой делает",
    "// create-modules.test.ts.",
    'import type { ModuleDescriptor, Platform, SystemPlatform } from "../platform/module/define-module.ts";',
    ...imports,
    "",
    "/** Порты платформы: SystemPlatform отличается только SystemDb. */",
    "export interface ModulePorts {",
    "  readonly platform: Platform;",
    "  readonly systemPlatform: SystemPlatform;",
    "}",
    "",
    "export function createModules(ports: ModulePorts): readonly ModuleDescriptor[] {",
    ...calls,
    `  return [${ordered.map((m) => `${camel(m.id)}Module`).join(", ")}];`,
    "}",
    "",
  ].join("\n");
}
