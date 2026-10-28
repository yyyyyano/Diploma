// Курс НБРБ (STMT-09) и разбор ответа API: курс приходит десятичной дробью «BYN за Cur_Scale единиц» — в коде он целым
// в десятитысячных, чтобы сумма в BYN считалась без float (@kosht/calc toByn).
import { z } from "zod";

export interface FxRate {
  readonly id: string;
  readonly currency: string;
  /** День, на который НБРБ установил курс (в выходной — раньше запрошенного). */
  readonly rateDate: string;
  readonly rateE4: number;
  readonly scale: number;
}

/** Ответ `GET api.nbrb.by/exrates/rates/{ISO}?parammode=2&ondate=…` (SPEC §9.8). */
export const NbrbRate = z.object({
  Cur_Abbreviation: z.string(),
  Cur_Scale: z.int().positive(),
  Cur_OfficialRate: z.number().positive(),
  Date: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
});
export type NbrbRate = z.infer<typeof NbrbRate>;

/**
 * Курс из ответа НБРБ: десятичная дробь с ≤ 4 знаками → целое в десятитысячных через строку («2.9871» → 29871),
 * а не умножением float. Больше четырёх знаков — ответ не по формату (null).
 */
export function fromNbrb(answer: NbrbRate): Omit<FxRate, "id"> | null {
  const text = String(answer.Cur_OfficialRate);
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (match === null) return null;
  const [, whole = "0", fraction = ""] = match;
  return {
    currency: answer.Cur_Abbreviation,
    rateDate: answer.Date.slice(0, 10),
    rateE4: Number(whole) * 10_000 + Number(fraction.padEnd(4, "0")),
    scale: answer.Cur_Scale,
  };
}

/** День раньше: «2026-10-19» → «2026-10-18» (календарь — UTC-полночь, без часовых поясов). */
export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
