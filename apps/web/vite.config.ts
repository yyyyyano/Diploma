// Сборка и разработка сайта (ADR-0013): Vite 8 + React 19, файловые маршруты TanStack Router.
// Настройки генератора маршрутов — tsr.config.json (его же читает `tsr generate` в make typecheck); пути в нём —
// от папки сайта, поэтому здесь они делаются абсолютными: Vitest запускается из корня репозитория.
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, type ProxyOptions } from "vite";
import routerConfig from "./tsr.config.json" with { type: "json" };

const webDir = import.meta.dirname;

/** Адрес локального слушателя сервера (ADR-0016): процедуры живут под /api. */
export const API_TARGET = "http://127.0.0.1:8140";

/**
 * Прокси процедур в разработке. Без changeOrigin: сервер сверяет Host и Origin (CSRF, DNS-rebinding — T-059),
 * и с changeOrigin Host стал бы 127.0.0.1:8140 при Origin http://localhost:5173 — изменяющие запросы получили бы 403.
 * ws — для потоков нет: events.stream и чат идут по SSE (обычный HTTP).
 */
export const API_PROXY: Record<string, ProxyOptions> = {
  "/api": { target: API_TARGET },
};

/** Витрина компонентов /dev/gallery — только в разработке и сборке --mode e2e, в боевой сборке её нет. */
export const DEV_ROUTES_PATTERN = String.raw`^dev\.`;

export function routerOptions(mode: string) {
  return {
    target: "react" as const,
    autoCodeSplitting: true,
    routesDirectory: resolve(webDir, routerConfig.routesDirectory),
    generatedRouteTree: resolve(webDir, routerConfig.generatedRouteTree),
    addExtensions: routerConfig.addExtensions,
    quoteStyle: "double" as const,
    routeTreeFileHeader: routerConfig.routeTreeFileHeader,
    ...(mode === "production" ? { routeFileIgnorePattern: DEV_ROUTES_PATTERN } : {}),
  };
}

export default defineConfig(({ mode }) => ({
  root: webDir,
  // Плагин маршрутов — до React: он переписывает файлы маршрутов (разбиение кода по маршрутам).
  plugins: [tanstackRouter(routerOptions(mode)), react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: API_PROXY },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy: API_PROXY },
  build: {
    // CSP сервера разрешает шрифты только с 'self' (font-src): ничего не встраиваем как data:.
    assetsInlineLimit: 0,
  },
}));
