// Счета (STMT-01): список счетов домохозяйства сессии. «Наличные» есть у каждого с самого начала; остальные — из
// выписок и вручную (T-019). Название null — подпись по виду счёта даёт сайт из словаря («Наличные»), так счёт
// без своего имени переводится вместе с интерфейсом. Сумма — Money (копейки + валюта), строк сумм на проводе нет.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const AccountId = z.uuid().brand<"AccountId">();
export type AccountId = z.infer<typeof AccountId>;

/** Вид счёта: наличные (служебный, есть у каждого); остальные виды добавляет T-019. */
export const AccountKind = z.enum(["cash"]);

export const AccountListItem = z.strictObject({
  id: AccountId,
  kind: AccountKind,
  /** Своё название; null — подпись по виду. */
  name: z.string().nullable(),
  /** Остаток счёта (STMT-02; до операций — начальный остаток). */
  balance: Money.schema,
});
export type AccountListItem = z.infer<typeof AccountListItem>;

export const accountsContract = {
  /** Счета своего домохозяйства, «Наличные» — первыми. */
  list: oc
    .route({ method: "GET", path: "/accounts" })
    .output(z.strictObject({ items: z.array(AccountListItem) }))
    .errors(pickErrors("UNAUTHORIZED")),
};
