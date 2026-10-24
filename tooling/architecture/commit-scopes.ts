// Области коммитов для scope-enum commitlint (ADR-0001, корневой CLAUDE.md «Git»): id модулей из modules.ts
// и служебные области, перечисленные в корневом CLAUDE.md. Один источник для людей и для хука commit-msg.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODULES } from "./modules.ts";

const MARKER = "id модуля из `docs/CAPABILITIES.md` или";

/**
 * Служебные области из фразы «…id модуля из `docs/CAPABILITIES.md` или `web`, `server`, … `plan`.»
 * Фраза может быть перенесена на несколько строк; список кончается первой «`.».
 */
export function parseServiceScopes(claudeMd: string): string[] {
  const start = claudeMd.indexOf(MARKER);
  const end = start === -1 ? -1 : claudeMd.indexOf("`.", start + MARKER.length);
  const fragment = end === -1 ? "" : claudeMd.slice(start + MARKER.length, end + 1);
  const scopes = [...fragment.matchAll(/`([^`\s]+)`/g)].map((match) => match[1] ?? "");
  if (scopes.length === 0) {
    throw new Error(
      "commitlint: в корневом CLAUDE.md, раздел «Git», не найдена строка служебных областей " +
        `«${MARKER} \`web\`, \`server\`, … \`plan\`.» — верните её, иначе области коммитов не собрать.`,
    );
  }
  return scopes;
}

/** Все допустимые области коммита: id модулей и служебные области корневого CLAUDE.md. */
export function commitScopes(): string[] {
  const claudeMd = readFileSync(fileURLToPath(new URL("../../CLAUDE.md", import.meta.url)), "utf8");
  return [...new Set([...MODULES.map((m) => m.id), ...parseServiceScopes(claudeMd)])];
}
