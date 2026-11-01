// Предел ПДН из таблицы ставок (AFF-05, TAX-03): только подтверждённое значение, узел трассы с основанием и пояснением «откуда».
// Нет подтверждённого значения — числа нет, а не ноль (P1): вызывающий отвечает «нет подтверждённого предела».
import { node, type Calc } from "@kosht/calc";
import type { TraceRef } from "@kosht/kernel";
import type { NormTablesFacade } from "../../norm-tables/index.ts";

type Answer = Awaited<ReturnType<NormTablesFacade["rate"]>>;
export type FoundRate = Extract<Answer, { found: true }>;

const WHO = { developer: "разработчик", admin: "администратор" } as const;

/** Пояснение к узлу: источник и кто подтвердил — не длиннее 200 знаков (схема explain). */
function rateNote(rate: FoundRate): string {
  const { article, point, url } = rate.source;
  const where =
    article === null ? (url ?? "") : `${article}${point === null ? "" : `, п. ${point}`}`;
  const [year = "", month = "", day = ""] = rate.confirmedOn.split("-");
  return `${where}; подтвердил: ${WHO[rate.confirmedBy]} ${day}.${month}.${year}`.slice(0, 200);
}

/** Предел в сотых долях процента — узел трассы (4000 = 40 %). */
export function limitNode(rate: FoundRate): Calc<number> {
  const refs: readonly TraceRef[] =
    rate.versionId === null ? [] : [{ kind: "fragmentVersion", id: rate.versionId }];
  return node("afford.pdnLimit", rate.value, { refs, note: rateNote(rate) });
}
