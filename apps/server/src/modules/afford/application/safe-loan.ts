// Безопасный платёж по кредиту (AFF-05, AFF-06): предел ПДН (40 % или 50 % для белорусских товаров, кроме автомобилей) из таблицы
// ставок × доход «на руки» − платежи по кредитам сейчас; со ставкой и сроком, названными человеком, — наибольшая сумма кредита
// (аннуитет). Доход — оценка по выпискам (банк считает ПДН по своей методике); регулярного дохода нет — его называет человек.
// Банков и программ нет ни в расчёте, ни в ответе (P6): платежи по кредитам — суммой. Предел не подтверждён — «нет предела».
import { annuityPrincipal, node, safePayment, sum, type Calc } from "@kosht/calc";
import type { SafeLoanInput, SafeLoanResult } from "@kosht/contract";
import { Money, TraceId, type TraceValue } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Deps } from "./deps.ts";
import { limitNode } from "./rates.ts";

const BYN = "BYN";

/** Параметры таблицы ставок: общий предел и предел для белорусских товаров. */
const LIMIT_PARAM = { default: "pdn.limit.default", domestic: "pdn.limit.domestic-goods" } as const;

export function makeSafeLoan(d: Deps) {
  return async function safeLoan(s: ScopedDb, input: SafeLoanInput): Promise<SafeLoanResult> {
    const today = d.platform.clock.today();
    const domesticGoods = input.domesticGoods ?? false;
    if (input.income !== undefined && (input.income.currency !== BYN || input.income.minor <= 0)) {
      throw new AppError("VALIDATION", { field: "income" });
    }
    if ((input.rateBp === undefined) !== (input.months === undefined)) {
      throw new AppError("VALIDATION", { field: input.rateBp === undefined ? "rateBp" : "months" });
    }

    const free = await d.fin.freeBalance(s);
    const income: Calc<Money> | null =
      input.income !== undefined
        ? node("afford.income", input.income, { note: "указано вами" })
        : free.income;
    const loans = free.obligations.filter((row) => row.group === "loan").map((row) => row.amount);
    const [firstLoan, ...otherLoans] = loans;
    const currentPayments: Calc<Money> =
      firstLoan === undefined
        ? node("afford.currentPayments", Money.of(0, BYN), {
            note: "кредитов в регулярных платежах нет",
          })
        : sum("afford.currentPayments", [firstLoan, ...otherLoans]);

    const param = domesticGoods ? LIMIT_PARAM.domestic : LIMIT_PARAM.default;
    const rate = await d.normTables.rate(param, today);
    const limit = rate.found ? limitNode(rate) : null;

    const calcs: Calc<TraceValue>[] = [];
    const slot = (calc: Calc<TraceValue> | null): number =>
      calc === null ? -1 : calcs.push(calc) - 1;
    const result =
      income !== null && limit !== null && income.value.minor > 0
        ? safePayment({ income, limitBp: limit, currentPayments })
        : null;
    const room = result !== null && result.room.value.minor > 0 ? result.room : null;
    const rateNode = input.rateBp === undefined ? null : node("afford.rate", input.rateBp);
    const termNode = input.months === undefined ? null : node("afford.term", input.months);
    const maxLoan =
      room !== null && rateNode !== null && termNode !== null
        ? annuityPrincipal(room, rateNode, termNode)
        : null;

    const slots = {
      income: slot(income),
      currentPayments: slot(income === null ? null : currentPayments),
      limitAmount: slot(result?.limitAmount ?? null),
      safePayment: slot(room),
      maxLoan: slot(maxLoan),
    };
    const ids = await d.explain.saveMany(s, calcs);
    const amount = (calc: Calc<Money> | null, index: number) => {
      if (calc === null) return null;
      const id = ids[index];
      if (id === undefined) throw new Error("afford.explain: нет traceId для числа результата");
      return { amount: calc.value, traceId: TraceId.parse(id) };
    };

    return {
      status: limit === null ? "no-limit" : income === null ? "no-income" : "ok",
      domesticGoods,
      limitPercent: limit !== null && limit.value % 100 === 0 ? limit.value / 100 : null,
      missing: limit === null ? [param] : [],
      income: amount(income, slots.income),
      incomeSource: income === null ? null : input.income !== undefined ? "user" : "history",
      currentPayments: income === null ? null : amount(currentPayments, slots.currentPayments),
      limitAmount: amount(result?.limitAmount ?? null, slots.limitAmount),
      safePayment: amount(room, slots.safePayment),
      exceeded: result !== null && room === null,
      maxLoan:
        maxLoan === null || rateNode === null || termNode === null
          ? null
          : {
              amount: amount(maxLoan, slots.maxLoan) as NonNullable<ReturnType<typeof amount>>,
              rateBp: rateNode.value,
              months: termNode.value,
            },
    };
  };
}

export type SafeLoan = ReturnType<typeof makeSafeLoan>;
