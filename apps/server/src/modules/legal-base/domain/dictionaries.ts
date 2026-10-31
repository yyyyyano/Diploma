// Справочники администратора (LAW-40): семь редакторов — одна общая модель. Строка справочника — значения полей (`values`), её
// ключ (`id`) собирается из ключевых полей; поля, их тип и проверка описаны здесь один раз, остальное — общий код
// (application/dictionaries.ts) и общий редактор на сайте. Чистые функции: ни БД, ни настроек.
import { LAW_GROUPS } from "@kosht/contract";
import { PRAVO_ID } from "./act-links.ts";
import { normalizeAlias } from "./reference.ts";
import { TOPICS } from "./topics.ts";

export const DICTIONARY_KINDS = [
  "start-catalog",
  "epk-topics",
  "title-patterns",
  "organs",
  "aliases",
  "colloquial",
  "agency-pages",
] as const;
export type DictionaryKind = (typeof DICTIONARY_KINDS)[number];

export interface FieldDef {
  readonly name: string;
  readonly type: "text" | "area" | "select";
  readonly options?: readonly string[];
  readonly required: boolean;
}

interface KindDef {
  readonly fields: readonly FieldDef[];
  /** Поля, из которых собран ключ строки; изменение ключа при правке — перенос строки. */
  readonly keyFields: readonly string[];
}

const text = (name: string, required = true): FieldDef => ({ name, type: "text", required });
const select = (name: string, options: readonly string[], required = true): FieldDef => ({
  name,
  type: "select",
  options,
  required,
});

export const ACT_KINDS = ["law", "code", "decree", "resolution", "plenum"] as const;

export const KIND_DEFS: Readonly<Record<DictionaryKind, KindDef>> = {
  "start-catalog": {
    fields: [
      text("pravoId"),
      text("title"),
      text("label"),
      select("kind", ACT_KINDS),
      select("hasText", ["text", "card"]),
      select("group", LAW_GROUPS, false),
    ],
    keyFields: ["pravoId"],
  },
  "epk-topics": { fields: [text("rubric"), select("topic", TOPICS)], keyFields: ["rubric"] },
  "title-patterns": { fields: [text("pattern")], keyFields: ["pattern"] },
  organs: { fields: [text("pattern"), select("topic", TOPICS)], keyFields: ["pattern"] },
  aliases: { fields: [text("pravoId"), text("alias")], keyFields: ["pravoId", "alias"] },
  colloquial: {
    fields: [text("word"), { name: "terms", type: "area", required: true }],
    keyFields: ["word"],
  },
  "agency-pages": { fields: [text("url")], keyFields: ["url"] },
};

export type DictionaryValues = Readonly<Record<string, string>>;

/** Ключ строки — значения ключевых полей через «|» (у кратких имён — акт и имя). */
export function keyOf(kind: DictionaryKind, values: DictionaryValues): string {
  return KIND_DEFS[kind].keyFields.map((name) => values[name] ?? "").join("|");
}

/** Почему строка не принята: поле и код — в параметры `VALIDATION`, текст берёт сайт из словаря. */
export interface Invalid {
  readonly field: string;
  readonly reason: "required" | "format" | "too-long";
}

const MAX_TEXT = 500;

function isRegex(source: string): boolean {
  try {
    new RegExp(source, "u");
    return true;
  } catch {
    return false;
  }
}

/** «зарплата; заработная плата» → термины; пустые и повторы отбрасываются. */
export function parseTerms(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[;\n]/u)
        .map((term) => term.trim())
        .filter((term) => term !== ""),
    ),
  ];
}

const FORMAT: Partial<
  Record<DictionaryKind, Readonly<Record<string, (value: string) => boolean>>>
> = {
  "start-catalog": { pravoId: (v) => PRAVO_ID.test(v) },
  "epk-topics": { rubric: (v) => /^\d{2}(?:\.\d{2}){0,3}$/u.test(v) },
  "title-patterns": { pattern: isRegex },
  organs: { pattern: isRegex },
  aliases: { pravoId: (v) => PRAVO_ID.test(v) },
  colloquial: {
    word: (v) => /^[\p{L}\p{N}]+$/u.test(v),
    terms: (v) => parseTerms(v).length > 0 && parseTerms(v).length <= 10,
  },
  "agency-pages": {
    url: (v) => {
      try {
        const url = new URL(v);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    },
  },
};

/**
 * Привести и проверить значения строки: обрезать пробелы, нормализовать краткое имя и слово словаря (ё → е, нижний регистр),
 * проверить обязательность, длину, выбор из списка и формат. Первая ошибка — `Invalid`.
 */
export function checkValues(
  kind: DictionaryKind,
  input: DictionaryValues,
):
  | { readonly ok: true; readonly values: DictionaryValues }
  | { readonly ok: false; readonly invalid: Invalid } {
  const out: Record<string, string> = {};
  for (const field of KIND_DEFS[kind].fields) {
    let value = (input[field.name] ?? "").trim();
    if (kind === "aliases" && field.name === "alias") value = normalizeAlias(value);
    if (kind === "colloquial" && field.name === "word") value = normalizeAlias(value);
    if (value === "") {
      if (field.required) return { ok: false, invalid: { field: field.name, reason: "required" } };
      out[field.name] = "";
      continue;
    }
    if (value.length > MAX_TEXT)
      return { ok: false, invalid: { field: field.name, reason: "too-long" } };
    const known = field.type === "select" ? (field.options ?? []).includes(value) : true;
    const formatted = FORMAT[kind]?.[field.name]?.(value) ?? true;
    if (!known || !formatted)
      return { ok: false, invalid: { field: field.name, reason: "format" } };
    out[field.name] = field.name === "terms" ? parseTerms(value).join("; ") : value;
  }
  return { ok: true, values: out };
}
