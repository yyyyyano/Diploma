// AGT-06: ask_user — без execute (цикл останавливается), варианты несут значение факта, неподходящее значение не проходит.
import { describe, expect, it } from "vitest";
import { AskInput, askUserTool, optionToFact } from "./ask-user.ts";

describe("ask_user", () => {
  it("у инструмента нет execute — цикл агента остановится на вызове", () => {
    expect(askUserTool().execute).toBeUndefined();
  });

  it("вариант housingQueue и да-нет ключи превращаются в значение факта", () => {
    expect(optionToFact("housingQueue", "now")).toEqual({
      key: "housingQueue",
      status: "now",
      since: null,
    });
    expect(optionToFact("property.car", "yes")).toEqual({ key: "property.car", value: true });
    expect(optionToFact("largeFamily", "no")).toEqual({ key: "largeFamily", value: false });
    expect(optionToFact("mainEmployer", "yes")).toEqual({
      key: "mainEmployer",
      has: true,
      name: null,
    });
    expect(optionToFact("youngSpecialist", "yes")).toEqual({
      key: "youngSpecialist",
      value: true,
      until: null,
    });
  });

  it("детей, доходы и занятость вариантом не выбрать, как и чужое значение", () => {
    expect(optionToFact("children", "yes")).toBeUndefined();
    expect(optionToFact("employment", "yes")).toBeUndefined();
    expect(optionToFact("housingQueue", "maybe")).toBeUndefined();
    expect(optionToFact("property.car", "now")).toBeUndefined();
  });

  it("вход: вариант с неподходящим значением не проходит, выводимые системой ключи — тоже", () => {
    const ok = {
      factKey: "housingQueue",
      question: "Вы состояли на учёте?",
      options: [{ label: "Да", value: "now" }],
    };
    expect(AskInput.safeParse(ok).success).toBe(true);
    expect(AskInput.safeParse({ ...ok, options: [{ label: "Да", value: "yes" }] }).success).toBe(
      false,
    );
    expect(AskInput.safeParse({ ...ok, factKey: "finance.freeBalance" }).success).toBe(false);
    expect(AskInput.safeParse({ ...ok, userId: "x" }).success).toBe(false);
  });
});
