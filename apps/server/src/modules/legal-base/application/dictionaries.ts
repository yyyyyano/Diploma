// Справочники администратора (LAW-40): одна тройка `list / upsert / remove` по виду справочника на семь редакторов. Что именно лежит
// в строке, описано в domain/dictionaries.ts; здесь — как строка читается и пишется: три справочника в таблицах, три в
// настройках модуля, краткие имена — в `legal_act_aliases`. Администратор правит общую базу, данных пользователей здесь нет.
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SettingDef, Settings } from "../../../platform/settings/settings.ts";
import {
  checkValues,
  DICTIONARY_KINDS,
  keyOf,
  KIND_DEFS,
  parseTerms,
  type DictionaryKind,
  type DictionaryValues,
  type FieldDef,
} from "../domain/dictionaries.ts";
import type { ActKind } from "../domain/start-catalog.ts";
import type { Topic } from "../domain/topics.ts";
import { seedActs } from "../infrastructure/db/catalog.repo.ts";
import {
  aliasRows,
  colloquialTerms,
  organTopics,
  removeAlias,
  removeColloquial,
  removeOrgan,
  removeStartCatalogEntry,
  saveAlias,
  saveColloquial,
  saveOrgan,
  saveStartCatalogEntry,
  startCatalogEntries,
} from "../infrastructure/db/dictionaries.repo.ts";
import { AGENCY_PAGES, EPK_TOPICS, FILTER_TITLE_PATTERNS } from "../settings.ts";

export interface DictionaryRow {
  readonly id: string;
  readonly values: DictionaryValues;
}

export interface DictionaryView {
  readonly kind: DictionaryKind;
  readonly fields: readonly FieldDef[];
  readonly rows: readonly DictionaryRow[];
}

/** Как читается и пишется один вид справочника: ключ строки приходит уже вычисленным. */
interface Store {
  rows(): Promise<DictionaryValues[]>;
  /** Записать строку; `previousId` — ключ правимой строки (перенос при смене ключа). `false` — не нашлось акта (краткие имена). */
  write(values: DictionaryValues, previousId: string | null): Promise<boolean>;
  drop(id: string): Promise<boolean>;
}

export interface DictionariesDeps {
  readonly system: SystemDb;
  readonly settings: Pick<Settings, "get" | "set">;
}

export function makeDictionaries(d: DictionariesDeps) {
  const { system, settings } = d;

  const stores: Record<DictionaryKind, Store> = {
    "start-catalog": {
      rows: async () =>
        (await startCatalogEntries(system)).map((e) => ({
          pravoId: e.pravoId,
          title: e.title,
          label: e.label,
          kind: e.kind,
          hasText: e.hasText ? "text" : "card",
          group: e.group ?? "",
        })),
      write: async (v, previousId) => {
        const entry = {
          pravoId: v["pravoId"] ?? "",
          title: v["title"] ?? "",
          label: v["label"] ?? "",
          kind: (v["kind"] ?? "law") as ActKind,
          hasText: v["hasText"] === "text",
          group: v["group"] === "" ? null : (v["group"] ?? null),
        };
        await saveStartCatalogEntry(system, entry, previousId);
        // Акт заводится сразу: прогресс «N из M» на экране первого запуска и в админке считает его, загрузит — следующий проход.
        await seedActs(system, [entry], "start-catalog");
        return true;
      },
      drop: (id) => removeStartCatalogEntry(system, id),
    },
    "epk-topics": {
      rows: async () =>
        Object.entries(await settings.get(EPK_TOPICS))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([rubric, topic]) => ({ rubric, topic })),
      write: async (v, previousId) => {
        const next = { ...(await settings.get(EPK_TOPICS)) };
        if (previousId !== null) delete next[previousId];
        next[v["rubric"] ?? ""] = (v["topic"] ?? "taxes") as Topic;
        await settings.set(EPK_TOPICS, next);
        return true;
      },
      drop: async (id) => {
        const current = await settings.get(EPK_TOPICS);
        if (!(id in current)) return false;
        const { [id]: _removed, ...rest } = current;
        await settings.set(EPK_TOPICS, rest);
        return true;
      },
    },
    "title-patterns": listStore(FILTER_TITLE_PATTERNS, "pattern"),
    organs: {
      rows: async () => (await organTopics(system)).map((o) => ({ ...o })),
      write: async (v, previousId) => {
        await saveOrgan(
          system,
          { pattern: v["pattern"] ?? "", topic: (v["topic"] ?? "taxes") as Topic },
          previousId,
        );
        return true;
      },
      drop: (id) => removeOrgan(system, id),
    },
    aliases: {
      rows: async () => aliasRows(system),
      write: (v, previousId) => {
        const previous = previousId === null ? null : splitAliasKey(previousId);
        return saveAlias(
          system,
          { pravoId: v["pravoId"] ?? "", alias: v["alias"] ?? "" },
          previous,
        );
      },
      drop: (id) => removeAlias(system, splitAliasKey(id)),
    },
    colloquial: {
      rows: async () =>
        Object.entries(await colloquialTerms(system)).map(([word, terms]) => ({
          word,
          terms: terms.join("; "),
        })),
      write: async (v, previousId) => {
        await saveColloquial(system, v["word"] ?? "", parseTerms(v["terms"] ?? ""), previousId);
        return true;
      },
      drop: (id) => removeColloquial(system, id),
    },
    "agency-pages": listStore(AGENCY_PAGES, "url"),
  };

  /** Справочник-список строк в настройке модуля (шаблоны заголовков, ведомственные страницы): одно поле — оно же ключ. */
  function listStore(def: SettingDef<string[]>, field: string): Store {
    return {
      rows: async () => (await settings.get(def)).map((value) => ({ [field]: value })),
      write: async (v, previousId) => {
        const list = [...(await settings.get(def))];
        const value = v[field] ?? "";
        const at = previousId === null ? -1 : list.indexOf(previousId);
        if (at >= 0) list[at] = value;
        else list.push(value);
        await settings.set(def, list);
        return true;
      },
      drop: async (id) => {
        const list = await settings.get(def);
        if (!list.includes(id)) return false;
        await settings.set(
          def,
          list.filter((value) => value !== id),
        );
        return true;
      },
    };
  }

  async function view(kind: DictionaryKind): Promise<DictionaryView> {
    const rows = await stores[kind].rows();
    return {
      kind,
      fields: KIND_DEFS[kind].fields,
      rows: rows.map((values) => ({ id: keyOf(kind, values), values })),
    };
  }

  return {
    kinds: DICTIONARY_KINDS,
    list: view,

    /** Добавить строку (`id` = null) или изменить существующую; ключ занят другой строкой — `VALIDATION`. */
    async upsert(
      kind: DictionaryKind,
      id: string | null,
      input: DictionaryValues,
    ): Promise<DictionaryView> {
      const checked = checkValues(kind, input);
      if (!checked.ok) throw new AppError("VALIDATION", { ...checked.invalid });
      const key = keyOf(kind, checked.values);
      const known = new Set((await stores[kind].rows()).map((values) => keyOf(kind, values)));
      if (id !== null && !known.has(id)) throw new AppError("NOT_FOUND");
      if (key !== id && known.has(key)) {
        throw new AppError("VALIDATION", {
          field: KIND_DEFS[kind].keyFields[0] ?? "",
          reason: "duplicate",
        });
      }
      if (!(await stores[kind].write(checked.values, id))) {
        throw new AppError("VALIDATION", { field: "pravoId", reason: "unknown-act" });
      }
      return view(kind);
    },

    async remove(kind: DictionaryKind, id: string): Promise<DictionaryView> {
      if (!(await stores[kind].drop(id))) throw new AppError("NOT_FOUND");
      return view(kind);
    },
  };
}

/** Ключ краткого имени «ID|имя» → части; имя может содержать только буквы, цифры и пробелы (нормализация), «|» в нём нет. */
function splitAliasKey(id: string): { pravoId: string; alias: string } {
  const at = id.indexOf("|");
  return { pravoId: id.slice(0, at), alias: id.slice(at + 1) };
}

export type Dictionaries = ReturnType<typeof makeDictionaries>;
