// Ключ категории «system:код» / «custom:<id>» (как у групп агрегатов и лимитов) → ссылка на категорию.
import { CategoryId, SystemCategoryCode, type CategoryRef } from "@kosht/contract";

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
