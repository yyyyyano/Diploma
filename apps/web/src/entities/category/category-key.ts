// Ключ и название категории (отдельно от CategoryPicker: бейдж в уведомлениях оболочки не должен тянуть за собой
// выбор категории с окном и Mantine Select — бюджет первой загрузки, CONSTRAINTS). Ключ категории «system:код» / «custom:<id>» (как у групп агрегатов и лимитов) → ссылка на категорию.
import {
  CategoryId,
  SystemCategoryCode,
  type CategoryItem,
  type CategoryRef,
} from "@kosht/contract";
import type { TFunction } from "i18next";

/** Не по схеме — `undefined`: ключ из сервера может устареть (категорию удалили), экран не должен падать. */
export function categoryRefOf(key: string): CategoryRef | undefined {
  const [kind, id = ""] = key.split(":");
  if (kind === "system") {
    const code = SystemCategoryCode.safeParse(id);
    return code.success ? { type: "system", code: code.data } : undefined;
  }
  const custom = CategoryId.safeParse(id);
  return custom.success ? { type: "custom", id: custom.data } : undefined;
}

/** Значение выбора строкой: «system:taxi», «custom:<id>». */
export function refKey(ref: CategoryRef): string {
  return ref.type === "system" ? `system:${ref.code}` : `custom:${ref.id}`;
}

/** Название категории: встроенной — из словаря по коду, своей — как назвал человек. */
export function categoryName(t: TFunction<"categories">, item: CategoryItem): string {
  return item.ref.type === "system" ? t(`system.${item.ref.code}`) : (item.name ?? "");
}
