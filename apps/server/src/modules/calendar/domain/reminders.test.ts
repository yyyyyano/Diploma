// CAL-07, NFR-22: какие напоминания создать для события и какие из наступивших отправить.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { decideDelivery, defaultRemindDays, planReminders } from "./reminders.ts";

const day = (iso: string) => LocalDate.parse(iso);
const NOW = new Date("2026-11-20T08:00:00Z"); // 11:00 в Минске

describe("CAL-07: напоминания события — за 7 и 1 день по умолчанию", () => {
  it("событие 1 декабря: 24 ноября и 30 ноября в 09:00 по Минску", () => {
    const plan = planReminders({
      on: day("2026-12-01"),
      remindDays: [7, 1],
      now: NOW,
      time: "09:00",
      timeZone: "Europe/Minsk",
    });
    expect(plan.map((p) => [p.offsetDays, p.dueAt.toISOString()])).toEqual([
      [7, "2026-11-24T06:00:00.000Z"],
      [1, "2026-11-30T06:00:00.000Z"],
    ]);
  });

  it("срок уже прошёл — напоминание не создаётся (не присылаем «вчерашнее»): событие через 3 дня — только «за 1 день»", () => {
    const plan = planReminders({
      on: day("2026-11-23"),
      remindDays: [7, 1],
      now: NOW,
      time: "09:00",
      timeZone: "Europe/Minsk",
    });
    expect(plan.map((p) => p.offsetDays)).toEqual([1]);
  });

  it("«в день события» в 09:00, а сейчас уже 11:00 того дня — напоминания нет", () => {
    const plan = planReminders({
      on: day("2026-11-20"),
      remindDays: [0],
      now: NOW,
      time: "09:00",
      timeZone: "Europe/Minsk",
    });
    expect(plan).toEqual([]);
  });

  it("повторы дней схлопываются; события без даты (правило) напоминаний нет", () => {
    expect(
      planReminders({
        on: day("2026-12-01"),
        remindDays: [7, 7, 1],
        now: NOW,
        time: "09:00",
        timeZone: "Europe/Minsk",
      }),
    ).toHaveLength(2);
    expect(
      planReminders({
        on: null,
        remindDays: [7],
        now: NOW,
        time: "09:00",
        timeZone: "Europe/Minsk",
      }),
    ).toEqual([]);
  });
});

describe("CAL-04, CAL-07: напоминания по умолчанию — по типу события", () => {
  const settings = { general: [7, 1], warranty: [30, 7, 1], insurance: [7] };
  it("гарантия — ещё и за 30 дней; остальное — за 7 и 1", () => {
    expect(defaultRemindDays("warranty", settings)).toEqual([30, 7, 1]);
    expect(defaultRemindDays("own", settings)).toEqual([7, 1]);
    expect(defaultRemindDays("tax", settings)).toEqual([7, 1]);
  });
  it("CAL-05: страховка — одно напоминание за 7 дней (12.03 → 5 марта)", () => {
    expect(defaultRemindDays("insurance", settings)).toEqual([7]);
  });
});

describe("NFR-22: что отправить, когда тик нашёл наступившие напоминания", () => {
  const due = (id: string, eventId: string, offsetDays: number, on: string) => ({
    id,
    eventId,
    offsetDays,
    on: day(on),
  });

  it("один наступивший — отправляется", () => {
    const result = decideDelivery([due("a", "e1", 7, "2026-12-01")], day("2026-11-24"));
    expect(result.send.map((r) => r.id)).toEqual(["a"]);
    expect(result.skip).toEqual([]);
  });

  it("компьютер был выключен неделю: «за 7» и «за 1» наступили разом — шлём одно, самое близкое, второе пропущено", () => {
    const result = decideDelivery(
      [due("a", "e1", 7, "2026-12-01"), due("b", "e1", 1, "2026-12-01")],
      day("2026-12-01"),
    );
    expect(result.send.map((r) => r.id)).toEqual(["b"]);
    expect(result.skip.map((r) => r.id)).toEqual(["a"]);
  });

  it("событие уже прошло — напоминание пропускается, а не шлётся задним числом", () => {
    const result = decideDelivery([due("a", "e1", 1, "2026-11-30")], day("2026-12-02"));
    expect(result.send).toEqual([]);
    expect(result.skip.map((r) => r.id)).toEqual(["a"]);
  });

  it("событие сегодня: напоминание «в день события» отправляется", () => {
    const result = decideDelivery([due("a", "e1", 0, "2026-12-01")], day("2026-12-01"));
    expect(result.send.map((r) => r.id)).toEqual(["a"]);
  });

  it("разные события не мешают друг другу", () => {
    const result = decideDelivery(
      [due("a", "e1", 7, "2026-12-01"), due("b", "e2", 7, "2026-12-03")],
      day("2026-11-25"),
    );
    expect(result.send.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
