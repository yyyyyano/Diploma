// Гибридная категоризация (CAT-03, CAT-04, CAT-06, CAT-07, LLM-05): от дешёвого к дорогому — правила пользователя →
// справочник контрагентов → ключевые слова → MCC → модель. Правила отвечают сразу и без модели (путь запроса ручного
// ввода); модель — отдельным шагом, пакетом непокрытых (в worker), строго из существующих категорий; одинаковые
// классификации — из scopedCache (ключ с домохозяйством). Модель недоступна или ответила меткой вне списка — «Прочее»
// с источником fallback, без ошибки человеку. Источник категории возвращается — его сохраняет владелец операции
// («Откуда эта цифра?»). Модель — вне транзакций (шлюз сам откажет внутри).
import {
  FALLBACK_CATEGORY,
  SYSTEM_CATEGORIES,
  type CategoryKind,
  type CategoryRef,
  type CategorySource,
} from "@kosht/contract";
import { createT } from "@kosht/i18n";
import type { CacheView } from "../../../platform/cache/scoped-cache.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import type { LlmFacade } from "../../llm/index.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import { matchMcc, matchText } from "../domain/match.ts";
import { listGlobalRules } from "../infrastructure/db/global.repo.ts";
import {
  hiddenCodes,
  listCustom,
  listUserRules,
  type UserRule,
} from "../infrastructure/db/categories.repo.ts";
import { MODEL_BATCH } from "../settings.ts";
import {
  CATEGORIZE_PROMPT_VERSION,
  CategorizeAnswer,
  categorizeInstructions,
} from "./categorize.prompt.ts";

/** Что категоризировать: операция (описание, MCC) или позиция чека (наименование). */
export interface CategorizeInput {
  /** Ключ вызывающего — вернётся в ответе (id операции или позиции). */
  readonly key: string;
  readonly kind: CategoryKind;
  readonly description?: string;
  readonly mcc?: string | null;
  readonly item?: string;
}

export interface Categorized {
  readonly key: string;
  readonly category: CategoryRef;
  readonly source: CategorySource;
}

/** Не покрыто правилами: текст для модели. */
export interface Pending extends CategorizeInput {
  readonly text: string;
}

export interface CategorizeDeps {
  readonly system: SystemDb;
  readonly merchants: Pick<MerchantsFacade, "resolve" | "normalizeItemName">;
  readonly llm: Pick<LlmFacade, "extract">;
  readonly settings: Pick<Settings, "get">;
  readonly cache: (s: ScopedDb) => CacheView<string>;
  readonly log: Logger;
}

const KIND_OF = new Map<string, CategoryKind>(SYSTEM_CATEGORIES.map((c) => [c.code, c.kind]));
const t = createT();

function system(code: string): CategoryRef {
  return { type: "system", code: code as (typeof SYSTEM_CATEGORIES)[number]["code"] };
}

function refOf(rule: UserRule): CategoryRef {
  return rule.categoryId === null
    ? system(rule.systemCode ?? "other")
    : { type: "custom", id: rule.categoryId as never };
}

export function makeCategorize(d: CategorizeDeps) {
  /** Шаг правил: сразу, без модели. Непокрытое — в pending (с текстом для модели). */
  async function byRules(
    s: ScopedDb,
    inputs: readonly CategorizeInput[],
  ): Promise<{ resolved: Categorized[]; pending: Pending[] }> {
    const [userRules, globalRules] = await Promise.all([
      listUserRules(s),
      listGlobalRules(d.system),
    ]);
    const operations = inputs.filter((input) => input.item === undefined);
    const merchants = await d.merchants.resolve(operations.map((input) => input.description ?? ""));
    const merchantOf = new Map(operations.map((input, i) => [input.key, merchants[i]]));
    const resolved: Categorized[] = [];
    const pending: Pending[] = [];
    for (const input of inputs) {
      const allowed = (code: string) => KIND_OF.get(code) === input.kind;
      const done = (category: CategoryRef, source: CategorySource) =>
        resolved.push({ key: input.key, category, source });
      if (input.item !== undefined) {
        const name = d.merchants.normalizeItemName(input.item);
        const pattern = name.toUpperCase();
        const own = userRules.find((rule) => rule.matcher === "item" && rule.pattern === pattern);
        const global = matchText([pattern], globalRules, "item", allowed);
        if (own !== undefined) done(refOf(own), "user-rule");
        else if (global !== undefined) done(system(global.categoryCode), "keyword");
        else pending.push({ ...input, text: name });
        continue;
      }
      const merchant = merchantOf.get(input.key);
      const key = merchant?.key ?? "";
      const own =
        key === ""
          ? undefined
          : userRules.find((rule) => rule.matcher === "merchant" && rule.pattern === key);
      const fromDirectory =
        merchant?.categoryCode != null && allowed(merchant.categoryCode)
          ? merchant.categoryCode
          : undefined;
      const keyword = matchText(
        [key, (input.description ?? "").toUpperCase()],
        globalRules,
        "keyword",
        allowed,
      );
      const mcc = matchMcc(merchant?.mcc ?? input.mcc, globalRules, allowed);
      if (own !== undefined) done(refOf(own), "user-rule");
      else if (fromDirectory !== undefined) done(system(fromDirectory), "merchant");
      else if (keyword !== undefined) done(system(keyword.categoryCode), "keyword");
      else if (mcc !== undefined) done(system(mcc.categoryCode), "mcc");
      else pending.push({ ...input, text: merchant?.name || (input.description ?? "") });
    }
    return { resolved, pending };
  }

  /** Метки для модели: встроенные нужного типа без скрытых и свои не скрытые. */
  async function labelsFor(s: ScopedDb, kind: CategoryKind) {
    const [hidden, custom] = await Promise.all([hiddenCodes(s), listCustom(s)]);
    const labels = new Map<string, { ref: CategoryRef; name: string }>();
    for (const category of SYSTEM_CATEGORIES) {
      if (category.kind !== kind || hidden.has(category.code)) continue;
      labels.set(category.code, {
        ref: system(category.code),
        name: t(`categories:system.${category.code}`),
      });
    }
    for (const category of custom) {
      if (category.kind !== kind || category.hidden) continue;
      labels.set(`custom-${category.id}`, {
        ref: { type: "custom", id: category.id as never },
        name: category.name,
      });
    }
    return labels;
  }

  /**
   * Шаг модели (CAT-06): непокрытые — пачками по настройке, одна пачка — один запрос; одинаковые — из кэша (LLM-05).
   * Сбой модели или метка вне списка — «Прочее» (fallback). Только вне транзакции.
   */
  async function withModel(s: ScopedDb, pending: readonly Pending[]): Promise<Categorized[]> {
    const cache = d.cache(s);
    const result: Categorized[] = [];
    const batchSize = await d.settings.get(MODEL_BATCH);
    for (const kind of ["expense", "income"] as const) {
      const ofKind = pending.filter((item) => item.kind === kind);
      if (ofKind.length === 0) continue;
      const labels = await labelsFor(s, kind);
      const fallback = (key: string): Categorized => ({
        key,
        category: system(FALLBACK_CATEGORY[kind]),
        source: "fallback",
      });
      const cacheKey = (item: Pending) => `category:${kind}:${item.text.toUpperCase()}`;
      const toAsk: Pending[] = [];
      for (const item of ofKind) {
        const cached = cache.get(cacheKey(item));
        const label = cached === undefined ? undefined : labels.get(cached);
        if (label !== undefined)
          result.push({ key: item.key, category: label.ref, source: "cache" });
        else toAsk.push(item);
      }
      for (let start = 0; start < toAsk.length; start += batchSize) {
        const batch = toAsk.slice(start, start + batchSize);
        let answer: Map<number, string>;
        try {
          const response = await d.llm.extract(s.scope, {
            task: "classify.category",
            schema: CategorizeAnswer,
            instructions: categorizeInstructions(
              [...labels].map(([label, { name }]) => ({ label, name })),
            ),
            document: batch.map((item, i) => `${String(i + 1)}. ${item.text}`).join("\n"),
            promptVersion: CATEGORIZE_PROMPT_VERSION,
          });
          answer = new Map(response.results.map((row) => [row.line, row.label]));
        } catch (error) {
          d.log.warn({ err: error, count: batch.length }, "categories.model-failed");
          answer = new Map();
        }
        batch.forEach((item, i) => {
          const label = answer.get(i + 1);
          const found = label === undefined ? undefined : labels.get(label);
          if (label === undefined || found === undefined) {
            result.push(fallback(item.key));
            return;
          }
          cache.set(cacheKey(item), label);
          result.push({ key: item.key, category: found.ref, source: "model" });
        });
      }
    }
    return result;
  }

  /** Правила, затем модель для непокрытых; порядок ответа — порядок входа. Только вне транзакции. */
  async function categorize(
    s: ScopedDb,
    inputs: readonly CategorizeInput[],
  ): Promise<Categorized[]> {
    const { resolved, pending } = await byRules(s, inputs);
    const byKey = new Map(
      [...resolved, ...(await withModel(s, pending))].map((item) => [item.key, item]),
    );
    return inputs.map((input) => {
      const found = byKey.get(input.key);
      if (found === undefined) throw new Error("categorize: потерян ключ входа.");
      return found;
    });
  }

  return { byRules, withModel, categorize };
}

export type Categorize = ReturnType<typeof makeCategorize>;
