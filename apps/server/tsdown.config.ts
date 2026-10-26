// Сборка сервера для образа (ADR-0015, T-011): точка входа → ровно один .mjs без общих чанков (api, worker, bot и
// migrate — для make migrate в контейнере): сборка на точку входа отдельная, файл самодостаточен. Workspace-пакеты
// (@kosht/*) — исходники TypeScript, а Node не стирает типы в node_modules, поэтому они внутри бандла.
// npm-зависимости сервера остаются внешними и едут в образ папкой node_modules рядом: libpg-query грузит свой .wasm
// с диска (ADR-0019), pg-boss читает свой package.json (platform/jobs/install.ts). Папку dist чистит make build.
import { defineConfig, type UserConfig } from "tsdown";

const ENTRIES = {
  api: "src/entrypoints/api.ts",
  worker: "src/entrypoints/worker.ts",
  bot: "src/entrypoints/bot.ts",
  migrate: "src/main/migrate-cli.ts",
} as const;

export default defineConfig(
  Object.entries(ENTRIES).map(([name, file]): UserConfig => ({
    entry: { [name]: file },
    format: "esm",
    platform: "node",
    target: "node26",
    outDir: "dist",
    fixedExtension: true,
    dts: false,
    clean: false,
    deps: { alwaysBundle: [/^@kosht\//] },
  })),
);
