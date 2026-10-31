// Инструменты агента модуля accounts (AGT-03 «счета», AGT-05, AGT-07, ADR-0009): описание — по-английски и коротко,
// вход без владельца (данные — только ctx.s, scope запуска агента), выход — карточки из @kosht/contract. Создать и
// переименовать — сразу с undoToken; удалить — только ожидающее решение (destructive), исполняет его «Да» человека.
import {
  AccountId,
  AccountList,
  AccountListItem,
  CreateAccountInput,
  UndoToken,
} from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Accounts } from "../application/accounts.ts";

const AccountChange = z.object({ account: AccountListItem, undoToken: UndoToken });

export function accountsTools(accounts: Accounts) {
  return {
    list: defineTool({
      name: "list_accounts",
      toolset: "core",
      kind: "read",
      description:
        "List the user's accounts with balances (minor units), balance dates and totals in BYN at today's NBRB rate.",
      input: z.object({}),
      output: AccountList,
      execute: (ctx) => accounts.list(ctx.s),
    }),
    create: defineTool({
      name: "create_account",
      toolset: "planning",
      kind: "write",
      description:
        "Create an account (card, current, savings, deposit or cash in a currency). Returns it with an undo token.",
      input: z.object({ account: CreateAccountInput }),
      output: AccountChange,
      execute: (ctx, input) => accounts.create(ctx.s, input.account, ctx.channel),
    }),
    rename: defineTool({
      name: "rename_account",
      toolset: "planning",
      kind: "write",
      description: "Rename an account by id. Returns it with an undo token.",
      input: z.object({ id: AccountId, name: z.string().trim().min(1).max(60) }),
      output: AccountChange,
      execute: (ctx, input) => accounts.rename(ctx.s, input, ctx.channel),
    }),
    remove: defineTool({
      name: "delete_account",
      toolset: "planning",
      kind: "destructive",
      description:
        "Ask the user to confirm deleting an account by id. Nothing is deleted until the user says yes.",
      input: z.object({ id: AccountId }),
      propose: async (ctx, input) => ({
        decisionId: await accounts.requestDelete(ctx.s, input.id),
        count: 1,
      }),
    }),
  };
}
