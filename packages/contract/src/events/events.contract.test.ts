// NFR-21, ARCHITECTURE §10.1: события сайта — сигналы «что-то изменилось» и «как идёт фоновая работа». Данных в них
// нет: сайт по сигналу перезапрашивает нужное через обычные процедуры (TanStack Query invalidate).
import { describe, expect, it } from "vitest";
import { SiteEvent } from "./events.contract.ts";

const id = "0190f0a0-0000-7000-8000-000000000001";

describe("SiteEvent — progress", () => {
  it("с долей готовности 0..100", () => {
    const event = { type: "progress", entity: "receipt", id, percent: 40 };
    expect(SiteEvent.parse(event)).toEqual(event);
  });

  it("без доли — когда сколько осталось, неизвестно", () => {
    const event = { type: "progress", entity: "statement-import", id };
    expect(SiteEvent.parse(event)).toEqual(event);
  });

  it.each([-1, 101, 40.5])("доля %s не проходит", (percent) => {
    expect(SiteEvent.safeParse({ type: "progress", entity: "receipt", id, percent }).success).toBe(
      false,
    );
  });
});

describe("SiteEvent — changed", () => {
  it("сущность и id — без данных", () => {
    const event = { type: "changed", entity: "transaction", id };
    expect(SiteEvent.parse(event)).toEqual(event);
  });

  it("данные в событии не проходят: сайт перезапрашивает их сам", () => {
    expect(
      SiteEvent.safeParse({ type: "changed", entity: "transaction", id, amount: 100 }).success,
    ).toBe(false);
  });

  it("id — только uuid", () => {
    expect(SiteEvent.safeParse({ type: "changed", entity: "transaction", id: "42" }).success).toBe(
      false,
    );
  });

  it("сущность — короткое машинное имя в kebab-case", () => {
    expect(SiteEvent.safeParse({ type: "changed", entity: "Чек", id }).success).toBe(false);
    expect(SiteEvent.safeParse({ type: "changed", entity: "a".repeat(49), id }).success).toBe(
      false,
    );
  });
});

describe("SiteEvent — неизвестный вид", () => {
  it("не проходит", () => {
    expect(SiteEvent.safeParse({ type: "deleted", entity: "receipt", id }).success).toBe(false);
  });
});
