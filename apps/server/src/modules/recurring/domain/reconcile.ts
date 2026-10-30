// Сведение найденного поиском с уже известными платежами (REC-01, REC-02): чистые функции. Найденная серия — это либо
// новый платёж, либо обновление известного (тот же контрагент и направление, сумма и день рядом); исключённое и
// прекращённое человеком не оживает; поправленное человеком (`userFixed`) поиск не перетирает.
import type { RecurringPeriod } from "@kosht/calc";
import type { LocalDate } from "@kosht/kernel";
import { nextExpected, type Candidate, type DetectSettings, type Flow } from "./detect.ts";
import { initialState, sectionOf, type Section, type State } from "./rules.ts";

export type UserFixedField = "section" | "period" | "day" | "amount";

/** Повтор-основание: операция, её день и сумма в BYN (копейки). */
export interface Occurrence {
  readonly id: string;
  readonly on: string;
  readonly minor: number;
}

/** Известный платёж — то, что нужно для сведения. */
export interface KnownItem {
  readonly id: string;
  readonly flow: Flow;
  readonly merchantKey: string | null;
  readonly period: RecurringPeriod;
  readonly section: Section;
  readonly state: State;
  readonly anchorDay: number | null;
  readonly userFixed: readonly string[];
  readonly occurrences: readonly Occurrence[];
  readonly nextExpectedOn: LocalDate;
  readonly name: string;
  readonly memberIds: readonly string[];
  readonly lastOccurredOn: LocalDate | null;
  readonly categoryCode: string | null;
  readonly categoryId: string | null;
}

function meanMinor(occurrences: readonly { minor: number }[]): number | undefined {
  if (occurrences.length === 0) return undefined;
  return occurrences.reduce((sum, o) => sum + o.minor, 0) / occurrences.length;
}

/** Известный платёж, которому принадлежит найденная серия: тот же контрагент, направление, день и сумма рядом. */
export function matchCandidate(
  candidate: Candidate,
  items: readonly KnownItem[],
  taken: ReadonlySet<string>,
  settings: DetectSettings,
): KnownItem | undefined {
  const candidateMean = meanMinor(candidate.occurrences.map((o) => ({ minor: o.amountMinor })));
  let best: { item: KnownItem; distance: number } | undefined;
  for (const item of items) {
    if (taken.has(item.id)) continue;
    if (item.flow !== candidate.flow || item.merchantKey !== candidate.merchantKey) continue;
    if (item.period !== candidate.period && !item.userFixed.includes("period")) continue;
    const mean = meanMinor(item.occurrences);
    // Допуск при сведении вдвое шире поиска: сумма серии за месяцы чуть уходит, а платёж — тот же.
    if (
      mean !== undefined &&
      candidateMean !== undefined &&
      Math.abs(mean - candidateMean) * 100 > 2 * settings.amountTolerancePct * mean
    ) {
      continue;
    }
    const distance =
      item.anchorDay === null || candidate.anchorDay === null
        ? 0
        : Math.abs(item.anchorDay - candidate.anchorDay);
    if (item.anchorDay !== null && candidate.anchorDay !== null) {
      if (distance > 2 * settings.dayTolerance && !item.userFixed.includes("day")) continue;
    }
    if (best === undefined || distance < best.distance) best = { item, distance };
  }
  return best?.item;
}

export function toOccurrences(candidate: Candidate): Occurrence[] {
  return candidate.occurrences.map((o) => ({ id: o.id, on: o.on, minor: o.amountMinor }));
}

/** Поля нового платежа из найденной серии (раздел — по категории, состояние — по разделу). */
export function newItemOf(candidate: Candidate) {
  const section = sectionOf(candidate.flow, candidate.categoryCode);
  return {
    seriesKey: `${candidate.flow}|${candidate.merchantKey}|${candidate.anchorDay ?? "w"}`,
    merchantKey: candidate.merchantKey,
    name: candidate.merchantName,
    flow: candidate.flow,
    section,
    period: candidate.period,
    state: initialState(section),
    source: "detected" as const,
    anchorDay: candidate.anchorDay,
    occurrences: toOccurrences(candidate),
    memberIds: [...candidate.memberIds],
    lastOccurredOn: candidate.lastOccurredOn,
    nextExpectedOn: candidate.nextExpectedOn,
    categoryCode: candidate.categoryCode,
    categoryId: candidate.categoryId,
  };
}

export type ItemPatch = Partial<ReturnType<typeof newItemOf>>;

/**
 * Что поиск меняет в известном платеже; `undefined` — ничего (прекращённое и исключённое человеком не оживает, и
 * ничего не изменилось). «Возможно прекращён» снова «действует», когда ожидаемая дата ушла вперёд — платёж пришёл.
 */
export function patchFor(item: KnownItem, candidate: Candidate): ItemPatch | undefined {
  if (item.state === "excluded" || item.state === "ended") return undefined;
  const fixed = (field: UserFixedField) => item.userFixed.includes(field);
  const period = fixed("period") ? item.period : candidate.period;
  const anchorDay = fixed("day") ? item.anchorDay : candidate.anchorDay;
  const next: ReturnType<typeof newItemOf> = {
    ...newItemOf(candidate),
    period,
    anchorDay,
    section: fixed("section") ? item.section : sectionOf(candidate.flow, candidate.categoryCode),
    state:
      item.state === "maybe-ended" && candidate.nextExpectedOn > item.nextExpectedOn
        ? "active"
        : item.state,
    nextExpectedOn:
      fixed("period") || fixed("day")
        ? nextExpected(period, candidate.lastOccurredOn, anchorDay)
        : candidate.nextExpectedOn,
  };
  const current: Record<string, unknown> = { ...item };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === "seriesKey" || key === "source" || key === "merchantKey" || key === "flow")
      continue;
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) patch[key] = value;
  }
  return Object.keys(patch).length === 0 ? undefined : (patch as ItemPatch);
}
