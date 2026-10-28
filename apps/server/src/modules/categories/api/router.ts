// Процедуры categories (contract.categories.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { Catalog } from "../application/catalog.ts";

export function categoriesRouter(catalog: Catalog) {
  return {
    list: authed.categories.list.handler(({ context }) => catalog.list(context.s)),
    create: authed.categories.create.handler(({ input, context }) =>
      catalog.create(context.s, input),
    ),
    rename: authed.categories.rename.handler(({ input, context }) =>
      catalog.rename(context.s, input),
    ),
    setHidden: authed.categories.setHidden.handler(({ input, context }) =>
      catalog.setHidden(context.s, input),
    ),
  };
}
