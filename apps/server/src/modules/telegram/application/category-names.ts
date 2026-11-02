// Названия категорий по ключу `system:<код>` / `custom:<id>` (лимиты, уведомление о лимите): встроенные — из словаря сайта,
// свои — как назвал человек; неизвестный ключ показывается как есть.
import { resources } from "@kosht/i18n";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { TelegramDeps } from "./deps.ts";

export function makeCategoryNames(d: Pick<TelegramDeps, "neighbours">) {
  return async function categoryNames(s: ScopedDb): Promise<(categoryKey: string) => string> {
    const names = new Map<string, string>();
    const system = resources.ru.categories.system as Readonly<Record<string, string>>;
    for (const item of (await d.neighbours.categories.list(s)).items) {
      if (item.ref.type === "system") {
        names.set(`system:${item.ref.code}`, system[item.ref.code] ?? item.ref.code);
      } else {
        names.set(`custom:${item.ref.id}`, item.name ?? "");
      }
    }
    return (key) => names.get(key) ?? key;
  };
}
