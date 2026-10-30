// STMT-08, STMT-07: типы операций выписки — примеры из SPEC; ключи дублей.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import {
  classifyRow,
  daysBetween,
  findCounterpart,
  findPurchase,
  withoutRefundWords,
} from "./classify.ts";
import { duplicateFlags, rowKeys } from "./dedupe.ts";

const byn = (minor: number) => Money.of(minor, "BYN");

describe("STMT-08: типы операций", () => {
  it("снятие наличных — перевод (на «Наличные»), а не расход", () => {
    expect(classifyRow("Снятие наличных ATM 4455 MINSK", byn(-20_000))).toMatchObject({
      kind: "transfer",
      transfer: "cash",
      direction: "out",
      doubtful: false,
    });
  });

  it("внесение наличных — перевод внутрь", () => {
    expect(classifyRow("Внесение наличных через банкомат", byn(10_000))).toMatchObject({
      kind: "transfer",
      direction: "in",
      transfer: "cash",
    });
  });

  it("пополнение вклада и накопительного счёта — перевод, не расход", () => {
    expect(classifyRow("Пополнение вклада «Накопительный»", byn(-50_000))).toMatchObject({
      kind: "transfer",
      transfer: "deposit",
    });
  });

  it("«Перевод себе» — свой перевод без вопроса", () => {
    expect(classifyRow("Перевод себе", byn(-10_000))).toMatchObject({
      transfer: "own",
      doubtful: false,
    });
  });

  it("«между своими счетами» — перевод без вопроса", () => {
    expect(classifyRow("Перевод между своими счетами", byn(-10_000))).toMatchObject({
      kind: "transfer",
      transfer: "own",
      doubtful: false,
    });
  });

  it.each([
    ["Зарплата за сентябрь", "salary"],
    ["Аванс", "salary"],
    ["Поступление НПД самозанятый", "side-income"],
    ["Пособие по уходу за ребёнком", "benefits"],
    ["Проценты по вкладу", "interest"],
    ["Выплата НПД", "side-income"],
  ] as const)("«%s» — доход, категория %s", (text, code) => {
    expect(classifyRow(text, byn(150_000))).toMatchObject({ kind: "income", categoryCode: code });
  });

  it("возврат за покупку — возврат с категорией «Возвраты»", () => {
    expect(classifyRow("Возврат покупки EVROTORG", byn(2_500))).toMatchObject({
      kind: "refund",
      direction: "in",
      categoryCode: "refunds",
    });
  });

  it("платёж по кредиту — расход «Кредиты и займы»", () => {
    expect(classifyRow("Погашение кредита по договору 123", byn(-30_000))).toMatchObject({
      kind: "expense",
      categoryCode: "loans",
    });
  });

  it("«Перевод на карту …» без пары — спорное: пока расход, человеку — вопрос «Да/Нет»", () => {
    expect(classifyRow("Перевод на карту 4000 ****", byn(-5_000))).toMatchObject({
      kind: "expense",
      transfer: "person",
      doubtful: true,
    });
    expect(classifyRow("Перевод от Иван И.", byn(5_000))).toMatchObject({
      kind: "income",
      doubtful: true,
    });
  });

  it("обычная покупка — расход без пометок", () => {
    expect(classifyRow("EVROTORG T-0042 MINSK", byn(-1_914))).toEqual({
      kind: "expense",
      direction: "out",
      doubtful: false,
    });
  });
});

describe("STMT-08: пара перевода и покупка возврата", () => {
  const out = { date: "2026-09-10", direction: "out" as const, minor: 10_000, currency: "BYN" };

  it("зачисление той же суммы на другом счёте в пределах 3 дней — пара; ближайший день важнее", () => {
    const near = { ...out, direction: "in" as const, date: "2026-09-11", id: "near" };
    const far = { ...out, direction: "in" as const, date: "2026-09-13", id: "far" };
    expect(findCounterpart(out, [far, near], 3)?.id).toBe("near");
  });

  it("4 дня, другая сумма, другая валюта, то же направление — не пара", () => {
    const base = { ...out, direction: "in" as const };
    expect(findCounterpart(out, [{ ...base, date: "2026-09-14" }], 3)).toBeUndefined();
    expect(findCounterpart(out, [{ ...base, minor: 10_001 }], 3)).toBeUndefined();
    expect(findCounterpart(out, [{ ...base, currency: "USD" }], 3)).toBeUndefined();
    expect(findCounterpart(out, [{ ...out }], 3)).toBeUndefined();
  });

  it("возврат связан с покупкой: тот же контрагент, сумма не больше покупки, окно; позднюю предпочитает", () => {
    const refund = { date: "2026-09-20", merchantKey: "EVROTORG", minor: 2_000, currency: "BYN" };
    const old = {
      date: "2026-09-01",
      merchantKey: "EVROTORG",
      minor: 5_000,
      currency: "BYN",
      id: "old",
    };
    const recent = { ...old, date: "2026-09-15", id: "recent" };
    expect(findPurchase(refund, [old, recent], 60)?.id).toBe("recent");
    expect(findPurchase(refund, [{ ...old, minor: 1_000 }], 60)).toBeUndefined();
    expect(findPurchase(refund, [{ ...old, merchantKey: "GIPPO" }], 60)).toBeUndefined();
    expect(findPurchase(refund, [old], 10)).toBeUndefined();
    expect(findPurchase({ ...refund, merchantKey: null }, [old], 60)).toBeUndefined();
  });

  it("слова «Возврат покупки» отбрасываются — остаётся контрагент; без слов описание как есть", () => {
    expect(withoutRefundWords("Возврат покупки EVROTORG T-0042 MINSK")).toBe(
      "EVROTORG T-0042 MINSK",
    );
    expect(withoutRefundWords("Refund: GIPPO")).toBe("GIPPO");
    expect(withoutRefundWords("Возврат")).toBe("Возврат");
    expect(withoutRefundWords("EVROTORG")).toBe("EVROTORG");
  });

  it("дней между днями — по модулю", () => {
    expect(daysBetween("2026-09-10", "2026-09-13")).toBe(3);
    expect(daysBetween("2026-09-13", "2026-09-10")).toBe(3);
  });
});

describe("STMT-07: ключ дубля", () => {
  const row = (description: string, minor = -300, date = "2026-09-01") => ({
    date,
    minor,
    currency: "BYN",
    description,
  });

  it("два одинаковых кофе за 3 BYN в один день — разные ключи (порядковый номер), оба сохраняются", () => {
    const [first, second] = rowKeys("acc", [row("Кофейня"), row("Кофейня")]);
    expect(first?.dedupeKey).not.toBe(second?.dedupeKey);
    expect(first?.dedupeKey.endsWith("#1")).toBe(true);
    expect(second?.dedupeKey.endsWith("#2")).toBe(true);
  });

  it("регистр, «ё» и пробелы в описании ключ не меняют", () => {
    expect(rowKeys("a", [row("Кафе  ЁЖИК")])[0]?.dedupeKey).toBe(
      rowKeys("a", [row("кафе ежик")])[0]?.dedupeKey,
    );
  });

  it("повторная загрузка той же выписки: все строки — дубли; новая строка — нет", () => {
    const rows = [row("Кофейня"), row("Кофейня"), row("Аптека", -1_000)];
    const known = new Set(rowKeys("acc", rows).map((key) => key.dedupeKey));
    expect(duplicateFlags(rowKeys("acc", rows), known, new Set())).toEqual([true, true, true]);
    const more = [...rows, row("Новая покупка", -700, "2026-09-02")];
    expect(duplicateFlags(rowKeys("acc", more), known, new Set())).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("банковский идентификатор операции: совпал — дубль, даже если описание изменилось", () => {
    const a = rowKeys("acc", [{ ...row("Старое описание"), operationId: "777" }]);
    const b = rowKeys("acc", [{ ...row("Новое описание"), operationId: "777" }]);
    expect(
      duplicateFlags(
        b,
        new Set(a.map((k) => k.dedupeKey)),
        new Set(a.flatMap((k) => k.externalId ?? [])),
      ),
    ).toEqual([true]);
  });

  it("другой счёт — не дубль", () => {
    const keys = rowKeys("acc-1", [row("Кофейня")]);
    expect(
      duplicateFlags(
        rowKeys("acc-2", [row("Кофейня")]),
        new Set(keys.map((k) => k.dedupeKey)),
        new Set(),
      ),
    ).toEqual([false]);
  });
});
