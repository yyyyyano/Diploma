// Числа вычетов из таблицы ставок (TAX-03): только подтверждённые значения, каждое — узел трассы с основанием (версия фрагмента
// нормы) и пояснением «ст. 214, п. 1.1; подтверждено разработчиком 01.11.2026». Нет подтверждённого — значения в ответе нет, а
// не ноль (P1): вызывающий отвечает «нет данных».
import { node, type Calc } from "@kosht/calc";
import { Money, type TraceRef } from "@kosht/kernel";
import type { NormTablesFacade } from "../../norm-tables/index.ts";

type Answer = Awaited<ReturnType<NormTablesFacade["rate"]>>;
export type FoundRate = Extract<Answer, { found: true }>;

export type RateReader = NormTablesFacade["rate"];

const WHO = { developer: "разработчик", admin: "администратор" } as const;

/** Пояснение к узлу: статья, пункт и кто подтвердил — трасса показывает, откуда число (не длиннее 200 знаков, схема explain). */
export function rateNote(rate: FoundRate): string {
  const { article, point, url } = rate.source;
  const where =
    article === null ? (url ?? "") : `ст. ${article}${point === null ? "" : `, п. ${point}`}`;
  const [year = "", month = "", day = ""] = rate.confirmedOn.split("-");
  return `${where}; подтвердил: ${WHO[rate.confirmedBy]} ${day}.${month}.${year}`.slice(0, 200);
}

function refsOf(rate: FoundRate): readonly TraceRef[] {
  return rate.versionId === null ? [] : [{ kind: "fragmentVersion", id: rate.versionId }];
}

/** Сумма вычета из таблицы (копейки BYN) — узел трассы. */
export function moneyNode(key: string, rate: FoundRate): Calc<Money> {
  return node(key, Money.of(rate.value, "BYN"), { refs: refsOf(rate), note: rateNote(rate) });
}

/** Ставка в сотых долях процента — узел трассы (1300 = 13 %). */
export function percentNode(key: string, rate: FoundRate): Calc<number> {
  return node(key, rate.value, { refs: refsOf(rate), note: rateNote(rate) });
}

export interface LoadedRates {
  readonly found: ReadonlyMap<string, FoundRate>;
  /** Параметры, у которых нет подтверждённого значения на день (нет данных или ждёт подтверждения). */
  readonly missing: readonly string[];
}

/** Подтверждённые значения параметров на день; недостающие — в `missing` по порядку запроса. */
export async function loadRates(
  read: RateReader,
  params: readonly string[],
  day: string,
): Promise<LoadedRates> {
  const found = new Map<string, FoundRate>();
  const missing: string[] = [];
  for (const param of params) {
    const answer = await read(param, day);
    if (answer.found) found.set(param, answer);
    else missing.push(param);
  }
  return { found, missing };
}
