// Категории (CAT-01, CAT-02): встроенные — общие для всех (один уровень: 26 расходных и 7 доходных), свои — у
// домохозяйства. Ссылка на категорию — встроенная по коду или своя по id (в базе — две колонки и CHECK «ровно одна»).
// Встроенная не удаляется, только скрывается; свою можно добавить, переименовать, скрыть. Название встроенной — на
// сайте из словаря по коду (`categories:system.<код>`), своей — как назвал человек. Иконка и цвет — ключи дизайн-системы.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

export const CategoryKind = z.enum(["expense", "income"]);
export type CategoryKind = z.infer<typeof CategoryKind>;

/** Ключ цвета категории — таблица ui/theme/category-colors.ts (DES-14). */
export const CATEGORY_COLOR_KEYS = [
  "groceries",
  "utilities",
  "cafes",
  "car",
  "kids",
  "taxi",
  "loans",
  "education",
  "telecom",
  "subscriptions",
  "health",
  "clothes",
  "leisure",
  "household",
  "beauty",
  "salary",
  "other",
] as const;
export const CategoryColorKey = z.enum(CATEGORY_COLOR_KEYS);
export type CategoryColorKey = z.infer<typeof CategoryColorKey>;

/** Иконка категории — ключ значка Lucide в ui/components/CategoryIcon. */
export const CATEGORY_ICON_KEYS = [
  "shopping-cart",
  "utensils",
  "wine",
  "spray-can",
  "sparkles",
  "pill",
  "shirt",
  "smartphone",
  "sofa",
  "lightbulb",
  "key-round",
  "wifi",
  "repeat",
  "bus",
  "car-taxi-front",
  "fuel",
  "graduation-cap",
  "baby",
  "paw-print",
  "ticket",
  "plane",
  "gift",
  "landmark",
  "receipt",
  "percent",
  "circle-ellipsis",
  "briefcase",
  "laptop",
  "hand-coins",
  "piggy-bank",
  "undo-2",
  "hand-heart",
  "wallet",
] as const;
export const CategoryIconKey = z.enum(CATEGORY_ICON_KEYS);
export type CategoryIconKey = z.infer<typeof CategoryIconKey>;

interface SystemCategoryDef {
  readonly code: string;
  readonly kind: CategoryKind;
  readonly icon: CategoryIconKey;
  readonly color: CategoryColorKey;
}

/** CAT-01: встроенные категории в порядке показа — 26 расходных, затем 7 доходных. Сид таблицы — миграция. */
export const SYSTEM_CATEGORIES = [
  { code: "groceries", kind: "expense", icon: "shopping-cart", color: "groceries" },
  { code: "cafes", kind: "expense", icon: "utensils", color: "cafes" },
  { code: "alcohol", kind: "expense", icon: "wine", color: "subscriptions" },
  { code: "household", kind: "expense", icon: "spray-can", color: "household" },
  { code: "beauty", kind: "expense", icon: "sparkles", color: "beauty" },
  { code: "health", kind: "expense", icon: "pill", color: "health" },
  { code: "clothes", kind: "expense", icon: "shirt", color: "clothes" },
  { code: "electronics", kind: "expense", icon: "smartphone", color: "leisure" },
  { code: "home", kind: "expense", icon: "sofa", color: "household" },
  { code: "utilities", kind: "expense", icon: "lightbulb", color: "utilities" },
  { code: "rent", kind: "expense", icon: "key-round", color: "utilities" },
  { code: "telecom", kind: "expense", icon: "wifi", color: "telecom" },
  { code: "subscriptions", kind: "expense", icon: "repeat", color: "subscriptions" },
  { code: "transport", kind: "expense", icon: "bus", color: "education" },
  { code: "taxi", kind: "expense", icon: "car-taxi-front", color: "taxi" },
  { code: "car", kind: "expense", icon: "fuel", color: "car" },
  { code: "education", kind: "expense", icon: "graduation-cap", color: "education" },
  { code: "kids", kind: "expense", icon: "baby", color: "kids" },
  { code: "pets", kind: "expense", icon: "paw-print", color: "kids" },
  { code: "leisure", kind: "expense", icon: "ticket", color: "leisure" },
  { code: "travel", kind: "expense", icon: "plane", color: "telecom" },
  { code: "gifts", kind: "expense", icon: "gift", color: "beauty" },
  { code: "loans", kind: "expense", icon: "landmark", color: "loans" },
  { code: "taxes", kind: "expense", icon: "receipt", color: "taxi" },
  { code: "fees", kind: "expense", icon: "percent", color: "other" },
  { code: "other", kind: "expense", icon: "circle-ellipsis", color: "other" },
  { code: "salary", kind: "income", icon: "briefcase", color: "salary" },
  { code: "side-income", kind: "income", icon: "laptop", color: "salary" },
  { code: "benefits", kind: "income", icon: "hand-coins", color: "kids" },
  { code: "interest", kind: "income", icon: "piggy-bank", color: "telecom" },
  { code: "refunds", kind: "income", icon: "undo-2", color: "groceries" },
  { code: "gifts-income", kind: "income", icon: "hand-heart", color: "beauty" },
  { code: "other-income", kind: "income", icon: "wallet", color: "other" },
] as const satisfies readonly SystemCategoryDef[];

export const SystemCategoryCode = z.enum(SYSTEM_CATEGORIES.map((category) => category.code));
export type SystemCategoryCode = z.infer<typeof SystemCategoryCode>;

/** «Прочее» по типу: запасная категория, когда ни правила, ни модель не помогли (CAT-03). */
export const FALLBACK_CATEGORY = { expense: "other", income: "other-income" } as const;

export const CategoryId = z.uuid().brand<"CategoryId">();
export type CategoryId = z.infer<typeof CategoryId>;

/** Ссылка на категорию: встроенная по коду или своя по id. */
export const CategoryRef = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("system"), code: SystemCategoryCode }),
  z.strictObject({ type: z.literal("custom"), id: CategoryId }),
]);
export type CategoryRef = z.infer<typeof CategoryRef>;

/**
 * Откуда категория (CAT-03, «Откуда эта цифра?»): выбрана человеком (`user`, операция, T-021), правило пользователя, справочник контрагентов, ключевое слово,
 * MCC, модель, кэш одинаковых классификаций (LLM-05), «Прочее» (ничего не подошло или модель недоступна).
 */
export const CategorySource = z.enum([
  "user",
  "user-rule",
  "merchant",
  "keyword",
  "mcc",
  "model",
  "cache",
  "fallback",
]);
export type CategorySource = z.infer<typeof CategorySource>;

export const CategoryItem = z.strictObject({
  ref: CategoryRef,
  kind: CategoryKind,
  /** Своё название; у встроенной null — подпись из словаря по коду. */
  name: z.string().nullable(),
  icon: CategoryIconKey,
  color: CategoryColorKey,
  hidden: z.boolean(),
});
export type CategoryItem = z.infer<typeof CategoryItem>;

const Name = z.string().trim().min(1).max(40);

export const NewCategoryInput = z.strictObject({
  name: Name,
  kind: CategoryKind,
  icon: CategoryIconKey.default("circle-ellipsis"),
  color: CategoryColorKey.default("other"),
});
export type NewCategoryInput = z.input<typeof NewCategoryInput>;

export const categoriesContract = {
  /** Встроенные (в порядке CAT-01) и свои категории домохозяйства, с признаком «скрыта». */
  list: oc
    .route({ method: "GET", path: "/categories" })
    .output(z.strictObject({ items: z.array(CategoryItem) }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** CAT-02: своя категория; такое же название того же типа — CONFLICT. */
  create: oc
    .route({ method: "POST", path: "/categories" })
    .input(NewCategoryInput)
    .output(z.strictObject({ item: CategoryItem }))
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION", "CONFLICT")),
  /** CAT-02: переименовать свою категорию (встроенную — нельзя: NOT_FOUND, её названия нет в базе). */
  rename: oc
    .route({ method: "POST", path: "/categories/rename" })
    .input(z.strictObject({ id: CategoryId, name: Name }))
    .output(z.strictObject({ item: CategoryItem }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** CAT-02: скрыть или показать — свою или встроенную (встроенная только скрывается, не удаляется). */
  setHidden: oc
    .route({ method: "POST", path: "/categories/hidden" })
    .input(z.strictObject({ ref: CategoryRef, hidden: z.boolean() }))
    .output(z.strictObject({ item: CategoryItem }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
};
