// Инструменты агента модуля afford (AGT-03 «планирование», AFF-01, AFF-05, ADR-0009): описание — по-английски и коротко, вход
// без владельца (данные — только ctx.s), выход — карточка из @kosht/contract. Числа считает программа: модель берёт суммы, даты
// и сроки из результата и сама не считает (P1). Названий банков и программ в результатах нет (P6): модель их не называет.
import { AffordInput, AffordResult, SafeLoanInput, SafeLoanResult } from "@kosht/contract";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { SafeLoan } from "../application/safe-loan.ts";
import type { Scenarios } from "../application/scenarios.ts";

export function affordTools(scenarios: Scenarios, safeLoan: SafeLoan) {
  return {
    affordScenarios: defineTool({
      name: "afford_scenarios",
      toolset: "planning",
      kind: "read",
      description:
        "Can the user afford a purchase? Price in BYN minor units, optional day (YYYY-MM-DD, default today). Returns three scenarios (now, after next income, save up) with lowest balance and date, shortfall risk and goal shift. If needs contains income, ask the user for expected monthly income and its day, then call again with expectedIncome and expectedIncomeOn. Never name banks or credit products.",
      input: AffordInput,
      output: AffordResult,
      execute: (ctx, input) => scenarios(ctx.s, AffordInput.parse(input)),
    }),
    safeLoanPayment: defineTool({
      name: "safe_loan_payment",
      toolset: "planning",
      kind: "read",
      description:
        "Safe new monthly loan payment under the national debt-burden rule (limit x income - current loan payments), and the largest loan for a rate (hundredths of a percent, 14% = 1400) and term in months named by the user. Status no-limit or no-income means no number: say why, never guess. Income is an estimate. Never name banks or credit products.",
      input: SafeLoanInput,
      output: SafeLoanResult,
      execute: (ctx, input) => safeLoan(ctx.s, SafeLoanInput.parse(input)),
    }),
  };
}
