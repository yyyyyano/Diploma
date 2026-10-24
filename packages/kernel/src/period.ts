// Период из календарных дней: обе границы включительно («октябрь» — с 2026-10-01 по 2026-10-31).
import { z } from "zod";
import { LocalDate } from "./local-date.ts";

/** Период `from…to`, обе границы входят; `from` не позже `to`. */
export interface Period {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

const schema = z
  .object({ from: LocalDate.schema, to: LocalDate.schema })
  .refine((period) => period.from <= period.to, { message: "Начало периода позже конца." })
  .readonly();

export const Period = {
  schema,

  /** Период с включительными границами; начало позже конца — `RangeError`. */
  of(from: LocalDate, to: LocalDate): Period {
    if (LocalDate.compare(from, to) > 0) {
      throw new RangeError(`Начало периода ${from} позже конца ${to}.`);
    }
    return { from, to };
  },

  /** Входит ли день в период (границы — входят). */
  contains(period: Period, day: LocalDate): boolean {
    return LocalDate.compare(period.from, day) <= 0 && LocalDate.compare(day, period.to) <= 0;
  },
} as const;
