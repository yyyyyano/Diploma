// Статика сайта (ADR-0005, ADR-0015): собранный Vite-сайт (WEB_DIST_DIR, по умолчанию apps/web/dist) отдаёт тот же
// процесс api, что и процедуры, — один адрес и одни заголовки безопасности. Маршруты SPA (/operations, /settings)
// — это index.html (SPA-fallback), а отсутствующий файл с расширением — 404: иначе опечатка в пути к скрипту
// получала бы HTML вместо ошибки. Путь из запроса — недоверенный ввод: каждый сегмент — только безопасные символы
// (без «..», точки в начале, обратного слэша, NUL и «%»), а итоговый файл после разрешения ссылок обязан лежать
// внутри корня (realpath) — ссылка наружу не отдаётся.
import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { getMimeType } from "hono/utils/mime";
import { API_PREFIX } from "./api.ts";

/** Сегмент пути: латиница, цифры, «_», «-», «.» — и не с точки (dotfiles и «..» не отдаются). */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** Файлы сборки с хэшем в имени (Vite кладёт их в assets/) кэшируются навсегда; остальное — с проверкой. */
const IMMUTABLE_DIR = "assets";

/** Ответ статики на GET/HEAD по пути URL или undefined (нет такого файла и не маршрут SPA). */
export async function siteResponse(root: string, pathname: string): Promise<Response | undefined> {
  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return undefined;
  const segments = safeSegments(pathname);
  if (segments === undefined) return undefined;
  const rootReal = await realpath(root).catch(() => undefined);
  if (rootReal === undefined) return undefined;

  const file = segments.length === 0 ? undefined : await insideRoot(rootReal, segments);
  if (file !== undefined) return fileResponse(file, segments[0] === IMMUTABLE_DIR);
  // Файл с расширением, которого нет, — 404; путь без расширения — маршрут сайта: index.html.
  if (segments.at(-1)?.includes(".") === true) return undefined;
  const index = await insideRoot(rootReal, ["index.html"]);
  return index === undefined ? undefined : fileResponse(index, false);
}

/** Сегменты пути после декодирования; хоть один небезопасный — undefined. */
function safeSegments(pathname: string): string[] | undefined {
  const parts = pathname.split("/").slice(1);
  // Завершающий «/» (/operations/) — тот же маршрут; пустой сегмент в середине (//) — нет.
  if (parts.at(-1) === "") parts.pop();
  const segments: string[] = [];
  for (const part of parts) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return undefined;
    }
    if (!SEGMENT.test(decoded)) return undefined;
    segments.push(decoded);
  }
  return segments;
}

/** Обычный файл внутри корня после разрешения ссылок, иначе undefined. */
async function insideRoot(
  rootReal: string,
  segments: readonly string[],
): Promise<string | undefined> {
  const real = await realpath(join(rootReal, ...segments)).catch(() => undefined);
  if (real === undefined || !real.startsWith(rootReal + sep)) return undefined;
  const info = await stat(real).catch(() => undefined);
  return info?.isFile() === true ? real : undefined;
}

async function fileResponse(file: string, immutable: boolean): Promise<Response> {
  return new Response(await readFile(file), {
    headers: {
      "content-type": getMimeType(file) ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}
