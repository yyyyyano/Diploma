// Владелец данных categories (PRIV-05/06): свои категории, скрытые встроенные и правила пользователя — в «Мои данные» и
// удаление аккаунта; дети раньше родителей (правила ссылаются на свои категории).
import { defineUserData } from "../../platform/db/user-data.ts";
import { categories, categoryRules, hiddenSystemCategories } from "./infrastructure/db/schema.ts";

export const categoriesUserData = defineUserData({
  tables: [categoryRules, hiddenSystemCategories, categories],
});
