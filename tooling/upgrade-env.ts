// make init на существующем .env (ADR-0020): приложение переходит с владельца базы на роль kosht_app. Агент и
// make .env не открывают и не печатают — правит эта программа и сообщает только имена переменных:
//   - DATABASE_URL и DB_PASSWORD_FILE, равные умолчаниям до T-060 (владелец kosht), — на новые умолчания;
//   - MIGRATION_DATABASE_URL и MIGRATION_DB_PASSWORD_FILE, если их нет, — дописываются в конец (владелец);
//   - остальное, в том числе свои значения разработчика, не трогается: несовпадение адресов покажет ConfigError;
//   - факты этой машины для Compose (T-011, ADR-0015) — RENDER_GID (группа render, GPU моделей), APP_UID и APP_GID
//     (пользователь контейнеров приложения: читает secrets/ и пишет data/) — ставятся значением из аргументов.
// Повторный запуск ничего не меняет.
//   node tooling/upgrade-env.ts <путь к .env> [RENDER_GID=992] [APP_UID=1000] [APP_GID=1000]
import { readFileSync, writeFileSync } from "node:fs";

/** Умолчания до T-060: приложение работало владельцем базы. */
const REPLACE: Readonly<Record<string, { readonly old: string; readonly next: string }>> = {
  DATABASE_URL: {
    old: "postgres://kosht@127.0.0.1:5440/kosht",
    next: "postgres://kosht_app@127.0.0.1:5440/kosht",
  },
  DB_PASSWORD_FILE: { old: "secrets/db_password", next: "secrets/db_app_password" },
};

/** Переменные владельца — значения те же, что в .env.example. */
export const APPEND: Readonly<Record<string, string>> = {
  MIGRATION_DATABASE_URL: "postgres://kosht@127.0.0.1:5440/kosht",
  MIGRATION_DB_PASSWORD_FILE: "secrets/db_password",
};

export const NEW_DEFAULTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(REPLACE).map(([name, { next }]) => [name, next]),
);

/** Факты машины, которые make init пишет в .env: только эти имена и только числа. */
export const HOST_FACTS = ["RENDER_GID", "APP_UID", "APP_GID"] as const;
export type HostFacts = Partial<Record<(typeof HOST_FACTS)[number], string>>;

export interface Upgrade {
  readonly text: string;
  /** Имена заменённых переменных. */
  readonly replaced: string[];
  /** Имена дописанных переменных. */
  readonly appended: string[];
  /** Имена фактов машины, которые поставлены или изменены. */
  readonly host: string[];
}

const LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;

/** Значение без кавычек (Node --env-file принимает '…' и "…"). */
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

export function upgradeEnv(text: string, facts: HostFacts = {}): Upgrade {
  const lines = text.split("\n");
  const present = new Set<string>();
  const replaced: string[] = [];
  const host: string[] = [];
  const result = lines.map((line) => {
    const match = LINE.exec(line);
    if (match === null) return line;
    const [, name = "", value = ""] = match;
    present.add(name);
    const fact = (facts as Record<string, string | undefined>)[name];
    if (fact !== undefined) {
      if (unquote(value) === fact) return line;
      host.push(name);
      return `${name}=${fact}`;
    }
    const rule = REPLACE[name];
    if (rule === undefined || unquote(value) !== rule.old) return line;
    replaced.push(name);
    return `${name}=${rule.next}`;
  });
  const appended = Object.keys(APPEND).filter((name) => !present.has(name));
  if (appended.length > 0) {
    if (result.at(-1) === "") result.pop();
    result.push(
      "# Владелец базы (ADR-0020): миграции и выдача прав роли приложения — дописано make init.",
      ...appended.map((name) => `${name}=${APPEND[name] ?? ""}`),
      "",
    );
  }
  const missing = HOST_FACTS.filter((name) => facts[name] !== undefined && !present.has(name));
  if (missing.length > 0) {
    if (result.at(-1) === "") result.pop();
    result.push(
      "# Факты этой машины для Compose (ADR-0015) — записано make init.",
      ...missing.map((name) => `${name}=${facts[name] ?? ""}`),
      "",
    );
    host.push(...missing);
  }
  return { text: result.join("\n"), replaced, appended, host };
}

/** Аргументы вида RENDER_GID=992: только имена HOST_FACTS и только целые числа; пустое значение пропускается. */
export function parseFacts(args: readonly string[]): HostFacts {
  const facts: Record<string, string> = {};
  for (const arg of args) {
    const [name = "", value = ""] = arg.split("=", 2);
    if (!(HOST_FACTS as readonly string[]).includes(name))
      throw new RangeError(`Неизвестный факт: ${name}`);
    if (value === "") continue;
    if (!/^\d{1,10}$/.test(value)) throw new RangeError(`${name}: ожидается целое число`);
    facts[name] = value;
  }
  return facts;
}

function main(file: string | undefined, args: readonly string[]): number {
  if (file === undefined) {
    process.stderr.write("Укажите файл: node tooling/upgrade-env.ts .env [RENDER_GID=…]\n");
    return 2;
  }
  const upgrade = upgradeEnv(readFileSync(file, "utf8"), parseFacts(args));
  if (upgrade.replaced.length === 0 && upgrade.appended.length === 0 && upgrade.host.length === 0) {
    process.stdout.write(`${file} уже актуален — не трогаю.\n`);
    return 0;
  }
  // Запись на место: права файла (0600 и т. п.) остаются прежними.
  writeFileSync(file, upgrade.text);
  const parts = [
    upgrade.replaced.length > 0 ? `заменено: ${upgrade.replaced.join(", ")}` : "",
    upgrade.appended.length > 0 ? `дописано: ${upgrade.appended.join(", ")}` : "",
    upgrade.host.length > 0 ? `факты машины: ${upgrade.host.join(", ")}` : "",
  ].filter((part) => part !== "");
  process.stdout.write(`${file} обновлён — ${parts.join("; ")}.\n`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv[2], process.argv.slice(3));
