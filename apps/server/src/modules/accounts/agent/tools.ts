// Инструменты агента модуля accounts (AGT-03, ADR-0009): описание — по-английски и коротко, вход без владельца
// (данные — только ctx.s, scope запуска агента), выход — компактная карточка из @kosht/contract.
import { AccountListItem } from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import { listAccountItems } from "../application/list-accounts.ts";

/** Счета домохозяйства с остатками: сайт рисует их карточками (CHAT-04). */
export const listAccountsTool = defineTool({
  name: "list_accounts",
  toolset: "core",
  kind: "read",
  description: "List the user's accounts with balances in minor units; cash comes first.",
  input: z.object({}),
  output: z.object({ items: z.array(AccountListItem) }),
  execute: (ctx) => listAccountItems(ctx.s),
});
