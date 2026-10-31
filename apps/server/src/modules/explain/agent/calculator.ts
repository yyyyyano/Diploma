// Инструмент агента «калькулятор» (AGT-03, AGT-04, P1, P2): арифметика над числами из результатов других инструментов
// и календарные даты («дата + N дней», «дней между датами») через `@kosht/calc`; каждый ответ несёт traceId — расчёт
// сохраняется для «Откуда эта цифра?». Выражения текстом не принимаются (ничего не исполняется): операция — из списка,
// числа — копейки и целые. Данные — только ctx.s (трасса сохраняется домохозяйству запуска).
import {
  dayCount,
  node,
  ratioPercent,
  scaleMoney,
  sub,
  sum,
  type Calc,
  type NonEmpty,
} from "@kosht/calc";
import { formatDate, formatMoney } from "@kosht/i18n";
import { LocalDate, Money, TraceId } from "@kosht/kernel";
import { z } from "zod";
import { AppError } from "../../../platform/errors/app-error.ts";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Explanations } from "../application/explanations.ts";

const ROUNDING = { rounding: "half-up-kopeck" } as const;
const MAX_VALUES = 50;

const CalculatorResult = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("money"),
    minor: z.number(),
    currency: z.string(),
    text: z.string(),
    traceId: TraceId,
  }),
  z.strictObject({
    kind: z.literal("percent"),
    value: z.number(),
    text: z.string(),
    traceId: TraceId,
  }),
  z.strictObject({
    kind: z.literal("days"),
    value: z.number(),
    text: z.string(),
    traceId: TraceId,
  }),
  z.strictObject({
    kind: z.literal("date"),
    date: z.string(),
    text: z.string(),
    traceId: TraceId,
  }),
]);

/** Целое из аргумента модели: дробное и нечисловое — `VALIDATION` (модель поправит вызов). */
function whole(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value)) throw new AppError("VALIDATION");
  return value;
}

function day(value: string | undefined): LocalDate {
  const parsed = LocalDate.schema.safeParse(value);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

export function calculatorTool(explanations: Pick<Explanations, "save">) {
  return defineTool({
    name: "calculator",
    toolset: "core",
    kind: "read",
    description:
      "Exact math in kopecks and dates. sum(values) sub(a,b) scale(a*b/c, c=1: x12, a third) percent(a of b) add_days(date,days) days_between(date,date2). Returns text, traceId.",
    input: z.strictObject({
      op: z.enum(["sum", "sub", "scale", "percent", "add_days", "days_between"]),
      values: z.array(z.number()).max(MAX_VALUES).optional(),
      a: z.number().optional(),
      b: z.number().optional(),
      c: z.number().optional(),
      currency: z.string().length(3).optional(),
      date: z.string().length(10).optional(),
      date2: z.string().length(10).optional(),
      days: z.number().optional(),
    }),
    output: CalculatorResult,
    execute: async (ctx, input) => {
      const currency = (input.currency ?? "BYN").toUpperCase();
      const money = (key: string, minor: number | undefined): Calc<Money> => {
        try {
          return node(key, Money.of(whole(minor), currency));
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError("VALIDATION");
        }
      };
      const moneyResult = async (calc: Calc<Money>) => ({
        kind: "money" as const,
        minor: calc.value.minor,
        currency: calc.value.currency,
        text: formatMoney(calc.value),
        traceId: await explanations.save(ctx.s, calc),
      });
      try {
        switch (input.op) {
          case "sum": {
            const terms = (input.values ?? []).map((minor) => money("calculator.operand", minor));
            if (terms.length === 0) throw new AppError("VALIDATION");
            return await moneyResult(
              sum("calculator.sum", terms as unknown as NonEmpty<Calc<Money>>),
            );
          }
          case "sub":
            return await moneyResult(
              sub("calculator.difference", money("calculator.operand", input.a), [
                money("calculator.operand", input.b),
              ]),
            );
          case "scale":
            return await moneyResult(
              scaleMoney(
                "calculator.scale",
                money("calculator.operand", input.a),
                node("calculator.numerator", whole(input.b)),
                node("calculator.denominator", input.c === undefined ? 1 : whole(input.c)),
                ROUNDING,
              ),
            );
          case "percent": {
            const calc = ratioPercent(
              "calculator.percent",
              money("calculator.part", input.a),
              money("calculator.whole", input.b),
              ROUNDING,
            );
            return {
              kind: "percent" as const,
              value: calc.value,
              text: `${String(calc.value)} %`,
              traceId: await explanations.save(ctx.s, calc),
            };
          }
          case "add_days": {
            const from = day(input.date);
            const days = whole(input.days);
            const result = LocalDate.addDays(from, days);
            const calc = dayCount(
              "calculator.days",
              days,
              `${from} ${days < 0 ? "−" : "+"} ${String(Math.abs(days))} дн. = ${result}`,
            );
            return {
              kind: "date" as const,
              date: result,
              text: formatDate(result),
              traceId: await explanations.save(ctx.s, calc),
            };
          }
          case "days_between": {
            const from = day(input.date);
            const to = day(input.date2);
            const days = LocalDate.daysBetween(from, to);
            const calc = dayCount("calculator.days", days, `${from} → ${to}`);
            return {
              kind: "days" as const,
              value: days,
              text: String(days),
              traceId: await explanations.save(ctx.s, calc),
            };
          }
        }
      } catch (error) {
        // Деление на ноль, чужая валюта и выход за диапазон — ошибка вызова модели, а не сбой программы.
        if (error instanceof RangeError) throw new AppError("VALIDATION");
        throw error;
      }
    },
  });
}
