// Инструменты агента модуля tax (AGT-03 «налоги и вычеты», ADR-0009): описание — по-английски и коротко, вход без владельца
// (данные — только ctx.s), выход — результат расчёта из @kosht/contract. Калькулятор считает программа по подтверждённой таблице
// ставок: модель берёт суммы, срок и ставку из результата и сама не считает (P1). Чек-лист документов — `get_checklist`
// (legal-consult), второго инструмента для него нет.
import {
  CalculateDeductionToolInput,
  DeductionResult,
  FoundList,
  type CalculateDeductionInput,
} from "@kosht/contract";
import { z } from "zod";
import { AppError } from "../../../platform/errors/app-error.ts";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Calculate } from "../application/calculate.ts";
import type { Found } from "../application/found.ts";

/** Плоский вход модели → вход калькулятора; не хватает поля вида вычета — `VALIDATION` с названием поля. */
export function toCalculateInput(input: CalculateDeductionToolInput): CalculateDeductionInput {
  const income = input.income === undefined ? {} : { income: input.income };
  if (input.kind === "education") {
    if (input.paid === undefined) throw new AppError("VALIDATION", { field: "paid" });
    return {
      kind: "education",
      paid: input.paid,
      ...(input.annualTaxable === undefined ? {} : { annualTaxable: input.annualTaxable }),
    };
  }
  if (input.kind === "housing") {
    if (input.expenses === undefined) throw new AppError("VALIDATION", { field: "expenses" });
    return { kind: "housing", expenses: input.expenses, ...income };
  }
  return { kind: "children", ...income };
}

export function taxTools(calculate: Calculate, found: Found) {
  return {
    calculateDeduction: defineTool({
      name: "calculate_deduction",
      toolset: "legal",
      kind: "read",
      description:
        "Calculate an income-tax deduction in Belarus: education (paid), housing (expenses) or children (from the profile). Uses only confirmed rates; returns savings, term, rate, way to get it and a checklist id. Status no-data or not-applicable means no number: say why, never guess. Amounts in BYN minor units.",
      input: CalculateDeductionToolInput,
      output: DeductionResult,
      execute: (ctx, input) => calculate(ctx.s, toCalculateInput(input)),
    }),
    foundDeductions: defineTool({
      name: "found_deductions",
      toolset: "legal",
      kind: "read",
      description:
        "List tax deductions the system found in the user's operations and profile (education payment, children, housing loan): kind, status, amount up to, payee, operation. Dismissed ones are not included. Amounts in BYN minor units.",
      input: z.strictObject({}),
      output: FoundList,
      execute: async (ctx) => ({
        items: (await found.list(ctx.s)).items.filter((item) => item.status !== "dismissed"),
      }),
    }),
  };
}
