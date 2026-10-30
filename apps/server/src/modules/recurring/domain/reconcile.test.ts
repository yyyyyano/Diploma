// REC-01, REC-02: сведение найденной серии с известными платежами.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { DEFAULT_DETECT, type Candidate } from "./detect.ts";
import { matchCandidate, newItemOf, patchFor, type KnownItem } from "./reconcile.ts";

const d = (text: string) => LocalDate.parse(text);

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    merchantKey: "gym",
    merchantName: "Фитнес-клуб",
    flow: "expense",
    period: "month",
    occurrences: [
      {
        id: "a",
        merchantKey: "gym",
        merchantName: "Фитнес-клуб",
        flow: "expense",
        on: d("2026-09-12"),
        amountMinor: 5_500,
        categoryCode: "leisure",
        categoryId: null,
      },
      {
        id: "b",
        merchantKey: "gym",
        merchantName: "Фитнес-клуб",
        flow: "expense",
        on: d("2026-10-12"),
        amountMinor: 5_500,
        categoryCode: "leisure",
        categoryId: null,
      },
    ],
    anchorDay: 12,
    lastOccurredOn: d("2026-10-12"),
    nextExpectedOn: d("2026-11-12"),
    categoryCode: "leisure",
    categoryId: null,
    ...over,
  };
}

function known(over: Partial<KnownItem> = {}): KnownItem {
  const base = newItemOf(candidate());
  return {
    id: "item-1",
    flow: base.flow,
    merchantKey: base.merchantKey,
    period: base.period,
    section: base.section,
    state: base.state,
    anchorDay: base.anchorDay,
    userFixed: [],
    occurrences: base.occurrences,
    nextExpectedOn: base.nextExpectedOn,
    name: base.name,
    memberIds: base.memberIds,
    lastOccurredOn: base.lastOccurredOn,
    categoryCode: base.categoryCode,
    categoryId: base.categoryId,
    ...over,
  };
}

describe("REC-02: новый платёж из найденной серии", () => {
  it("«Развлечения» — раздел «Другие», предположение; подписка — действует сразу", () => {
    expect(newItemOf(candidate())).toMatchObject({ section: "other", state: "suggested" });
    expect(newItemOf(candidate({ categoryCode: "subscriptions" }))).toMatchObject({
      section: "subscriptions",
      state: "active",
    });
  });
});

describe("REC-01: сведение с известным", () => {
  it("тот же контрагент, день и сумма — тот же платёж", () => {
    expect(matchCandidate(candidate(), [known()], new Set(), DEFAULT_DETECT)?.id).toBe("item-1");
  });

  it("другое направление или контрагент — другой платёж", () => {
    expect(
      matchCandidate(candidate({ flow: "income" }), [known()], new Set(), DEFAULT_DETECT),
    ).toBeUndefined();
    expect(
      matchCandidate(candidate({ merchantKey: "other" }), [known()], new Set(), DEFAULT_DETECT),
    ).toBeUndefined();
  });

  it("аванс (10-е) и зарплата (25-е) одного нанимателя не путаются", () => {
    const advance = known({ id: "advance", anchorDay: 10 });
    const salary = known({ id: "salary", anchorDay: 25 });
    const c = candidate({ anchorDay: 25 });
    expect(matchCandidate(c, [advance, salary], new Set(), DEFAULT_DETECT)?.id).toBe("salary");
  });

  it("уже занятый платёж другой серией не берётся", () => {
    expect(
      matchCandidate(candidate(), [known()], new Set(["item-1"]), DEFAULT_DETECT),
    ).toBeUndefined();
  });

  it("сумма ушла сильно — это другая серия того же получателя", () => {
    const rich = candidate({
      occurrences: candidate().occurrences.map((o) => ({ ...o, amountMinor: 20_000 })),
    });
    expect(matchCandidate(rich, [known()], new Set(), DEFAULT_DETECT)).toBeUndefined();
  });
});

describe("REC-02: что меняет поиск", () => {
  it("исключённое и прекращённое человеком не оживает", () => {
    expect(
      patchFor(known({ state: "excluded" }), candidate({ nextExpectedOn: d("2026-12-12") })),
    ).toBeUndefined();
    expect(
      patchFor(known({ state: "ended" }), candidate({ nextExpectedOn: d("2026-12-12") })),
    ).toBeUndefined();
  });

  it("ничего не изменилось — патча нет (повтор поиска не пишет и не шлёт событий)", () => {
    expect(patchFor(known(), candidate())).toBeUndefined();
  });

  it("пришёл новый платёж — «возможно прекращён» снова действует", () => {
    const patch = patchFor(
      known({ state: "maybe-ended" }),
      candidate({ lastOccurredOn: d("2026-11-14"), nextExpectedOn: d("2026-12-12") }),
    );
    expect(patch).toMatchObject({ state: "active", nextExpectedOn: "2026-12-12" });
  });

  it("платёж не пришёл — «возможно прекращён» остаётся", () => {
    expect(patchFor(known({ state: "maybe-ended" }), candidate())).toBeUndefined();
  });

  it("тип, поправленный человеком, и «предположение» следующим поиском не перетираются", () => {
    const patch = patchFor(
      known({ section: "mandatory", userFixed: ["section"] }),
      candidate({
        categoryCode: "leisure",
        nextExpectedOn: d("2026-12-12"),
        lastOccurredOn: d("2026-11-12"),
      }),
    );
    expect(patch).not.toHaveProperty("section");
  });

  it("день, поправленный человеком, остаётся, а ожидаемая дата считается от него", () => {
    const patch = patchFor(
      known({ anchorDay: 20, userFixed: ["day"] }),
      candidate({ lastOccurredOn: d("2026-10-12") }),
    );
    expect(patch).toMatchObject({ nextExpectedOn: "2026-11-20" });
    expect(patch).not.toHaveProperty("anchorDay");
  });
});
