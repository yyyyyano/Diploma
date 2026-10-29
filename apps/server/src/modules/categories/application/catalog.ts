// Справочник категорий домохозяйства (CAT-01, CAT-02, CAT-05): встроенные (общие, по порядку CAT-01) с признаком
// «скрыта» и свои — добавить, переименовать, скрыть; встроенная только скрывается (строка настроек домохозяйства).
// Правило пользователя (CAT-05) — фасадом для transactions: «эта категория для этого контрагента или товара».
import {
  CategoryColorKey,
  CategoryIconKey,
  CategoryId,
  CategoryKind,
  SystemCategoryCode,
  type CategoryItem,
  type CategoryRef,
  type NewCategoryInput,
} from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { z } from "zod";
import {
  deleteUserRule,
  findCustom,
  findUserRule,
  hiddenCodes,
  insertCustom,
  listCustom,
  setSystemHidden,
  updateCustom,
  upsertUserRule,
  type CustomRow,
} from "../infrastructure/db/categories.repo.ts";
import { listSystemCategories } from "../infrastructure/db/global.repo.ts";

export interface CatalogDeps {
  readonly system: SystemDb;
  readonly platform: Pick<Platform, "clock" | "realtime">;
}

function customItem(row: CustomRow): CategoryItem {
  return {
    ref: { type: "custom", id: CategoryId.parse(row.id) },
    kind: CategoryKind.parse(row.kind),
    name: row.name,
    icon: CategoryIconKey.parse(row.icon),
    color: CategoryColorKey.parse(row.color),
    hidden: row.hidden,
  };
}

/** Нарушение уникальности названия (categories_name_idx) — CONFLICT, а не INTERNAL. */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return (error as { code?: string } | null)?.code === "23505" || cause?.code === "23505";
}

export function makeCatalog(d: CatalogDeps) {
  async function list(s: ScopedDb): Promise<{ items: CategoryItem[] }> {
    const [system, hidden, custom] = await Promise.all([
      listSystemCategories(d.system),
      hiddenCodes(s),
      listCustom(s),
    ]);
    return {
      items: [
        ...system.map((row): CategoryItem => ({
          ref: { type: "system", code: SystemCategoryCode.parse(row.code) },
          kind: CategoryKind.parse(row.kind),
          name: null,
          icon: CategoryIconKey.parse(row.icon),
          color: CategoryColorKey.parse(row.color),
          hidden: hidden.has(row.code),
        })),
        ...custom.map(customItem),
      ],
    };
  }

  async function itemOf(s: ScopedDb, ref: CategoryRef): Promise<CategoryItem> {
    const found = (await list(s)).items.find((item) =>
      ref.type === "system"
        ? item.ref.type === "system" && item.ref.code === ref.code
        : item.ref.type === "custom" && item.ref.id === ref.id,
    );
    if (found === undefined) throw new AppError("NOT_FOUND");
    return found;
  }

  async function changed(s: ScopedDb, ids: readonly string[]): Promise<void> {
    await d.platform.realtime.changed(s, { entity: "category", ids: [...ids] });
  }

  /** CAT-02: своя категория; такое же название того же типа — CONFLICT. */
  async function create(
    s: ScopedDb,
    input: z.output<typeof NewCategoryInput>,
  ): Promise<{ item: CategoryItem }> {
    const id = await insertCustom(s, input);
    if (id === undefined) throw new AppError("CONFLICT");
    await changed(s, [id]);
    return { item: await itemOf(s, { type: "custom", id: CategoryId.parse(id) }) };
  }

  async function rename(
    s: ScopedDb,
    input: { id: string; name: string },
  ): Promise<{ item: CategoryItem }> {
    try {
      const updated = await updateCustom(s, input.id, { name: input.name }, d.platform.clock.now());
      if (!updated) throw new AppError("NOT_FOUND");
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError("CONFLICT");
      throw error;
    }
    await changed(s, [input.id]);
    return { item: await itemOf(s, { type: "custom", id: CategoryId.parse(input.id) }) };
  }

  /** CAT-02: скрыть или показать; встроенная — строкой настроек, своя — признаком. */
  async function setHidden(
    s: ScopedDb,
    input: { ref: CategoryRef; hidden: boolean },
  ): Promise<{ item: CategoryItem }> {
    if (input.ref.type === "system") {
      // Сигнал сайту — только с id строк (uuid): скрытие встроенной видно вкладке после её же запроса.
      await setSystemHidden(s, input.ref.code, input.hidden);
    } else {
      if ((await findCustom(s, input.ref.id)) === undefined) throw new AppError("NOT_FOUND");
      await updateCustom(s, input.ref.id, { hidden: input.hidden }, d.platform.clock.now());
      await changed(s, [input.ref.id]);
    }
    return { item: await itemOf(s, input.ref) };
  }

  /**
   * Фасад (CAT-05, T-022): правило пользователя «контрагент или позиция → категория» (новое или вместо прежнего).
   * Шаблон — ключ очищенного описания (merchants.cleanDescription) или нормализованное наименование в верхнем
   * регистре. Своя категория ищется через s — чужой id: NOT_FOUND.
   */
  async function setUserRule(
    s: ScopedDb,
    rule: { matcher: "merchant" | "item"; pattern: string; category: CategoryRef },
  ): Promise<void> {
    if (rule.category.type === "custom" && (await findCustom(s, rule.category.id)) === undefined) {
      throw new AppError("NOT_FOUND");
    }
    await upsertUserRule(
      s,
      {
        matcher: rule.matcher,
        pattern: rule.pattern.toUpperCase(),
        systemCode: rule.category.type === "system" ? rule.category.code : null,
        categoryId: rule.category.type === "custom" ? rule.category.id : null,
      },
      d.platform.clock.now(),
    );
  }

  /** Фасад (T-022): текущее правило пользователя по шаблону — чтобы «Отменить» вернуло прежнее. */
  async function userRule(
    s: ScopedDb,
    rule: { matcher: "merchant" | "item"; pattern: string },
  ): Promise<CategoryRef | undefined> {
    const found = await findUserRule(s, rule.matcher, rule.pattern.toUpperCase());
    if (found === undefined) return undefined;
    return found.categoryId === null
      ? { type: "system", code: SystemCategoryCode.parse(found.systemCode) }
      : { type: "custom", id: CategoryId.parse(found.categoryId) };
  }

  /** Фасад (T-022): убрать правило пользователя (правила, которого не было до «Отменить»). */
  async function removeUserRule(
    s: ScopedDb,
    rule: { matcher: "merchant" | "item"; pattern: string },
  ): Promise<void> {
    await deleteUserRule(s, rule.matcher, rule.pattern.toUpperCase());
  }

  return { list, create, rename, setHidden, setUserRule, userRule, removeUserRule };
}

export type Catalog = ReturnType<typeof makeCatalog>;
