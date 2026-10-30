// Категория в строке и карточке (CAT-01, design/screens/Operations.dc.html .cat): значок цвета категории и название —
// встроенной по коду из словаря, своей как назвал человек. Список категорий — один запрос на экран (categories.list);
// пока он грузится или категории нет, название не придумывается.
import type { CategoryItem, CategoryRef } from "@kosht/contract";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { CategoryIcon } from "../../ui/index.ts";
import classes from "./CategoryBadge.module.css";
import { categoryName, refKey } from "./category-key.ts";

/** Категории домохозяйства по ссылке: название, значок, цвет, вид. */
export function useCategoryLookup() {
  const { t } = useTranslation("categories");
  const list = useQuery(orpc.categories.list.queryOptions());
  const items = list.data?.items ?? [];
  const byKey = new Map(items.map((item) => [refKey(item.ref), item]));
  return {
    items,
    isError: list.isError,
    find: (ref: CategoryRef): CategoryItem | undefined => byKey.get(refKey(ref)),
    nameOf: (ref: CategoryRef): string => {
      const item = byKey.get(refKey(ref));
      return item === undefined
        ? ref.type === "system"
          ? t(`system.${ref.code}`)
          : ""
        : categoryName(t, item);
    },
  };
}

export function CategoryBadge({ category }: { readonly category: CategoryRef | null }) {
  const { t } = useTranslation("categories");
  const lookup = useCategoryLookup();
  if (category === null) return <span className={classes.none}>{t("none")}</span>;
  const item = lookup.find(category);
  return (
    <span className={classes.badge}>
      {item !== undefined && <CategoryIcon size="sm" icon={item.icon} color={item.color} />}
      <span className={classes.name}>{lookup.nameOf(category)}</span>
    </span>
  );
}
