// Сущность «категория» (ARCHITECTURE §10.1): выбор категории с «Новая категория», бейдж и название по ссылке — для
// операций, карточки чека и правил.
export { CategoryPicker, type CategoryPickerProps } from "./CategoryPicker.tsx";
export { CategoryBadge, useCategoryLookup } from "./CategoryBadge.tsx";
export { categoryName, categoryRefOf, refKey } from "./category-key.ts";
