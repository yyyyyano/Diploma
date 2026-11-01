// CHAT-04, CHAT-10: части сохранённого ответа — что из них годится для показа и какие версии статей в них названы.
import { describe, expect, it } from "vitest";
import { lawVersionIdsOf, validParts } from "./message-parts.ts";

const chart = {
  kind: "bar",
  title: "Кафе по месяцам",
  unit: "money",
  currency: "BYN",
  labels: ["июн"],
  series: [{ name: "Кафе", values: [1200] }],
};

const lawAnswer = (versionIds: string[]) => ({
  type: "data-law-answer",
  data: {
    outcome: "cited",
    parts: [{ type: "text", text: "Срок — 14 дней." }],
    citations: [],
    notices: [],
    versionIds,
  },
});

describe("validParts: что из сохранённого ответа показывается", () => {
  it("части AI SDK и данные-части реестра остаются как есть, в том же порядке", () => {
    const parts = [
      { type: "text", text: "Вот график" },
      { type: "data-chart", data: chart },
      { type: "tool-search_transactions", state: "output-available" },
    ];
    expect(validParts(parts)).toEqual({ parts, dropped: 0 });
  });

  it("данные-часть с испорченными данными отбрасывается и считается; остальные остаются", () => {
    const bad = { type: "data-chart", data: { ...chart, series: [] } };
    const good = { type: "text", text: "ok" };
    expect(validParts([bad, good, { type: "data-unknown", data: 1 }])).toEqual({
      parts: [good],
      dropped: 2,
    });
  });

  it("не массив — пустой ответ", () => {
    expect(validParts(null)).toEqual({ parts: [], dropped: 0 });
  });
});

describe("lawVersionIdsOf: версии статей правового ответа", () => {
  it("собирает id из всех правовых частей без повторов", () => {
    const parts = [
      lawAnswer(["12", "13"]),
      { type: "text", text: "и ещё" },
      lawAnswer(["13", "20"]),
    ];
    expect(lawVersionIdsOf(parts)).toEqual(["12", "13", "20"]);
  });

  it("часть с испорченными данными пропускается, а не роняет чтение", () => {
    expect(lawVersionIdsOf([{ type: "data-law-answer", data: { versionIds: 5 } }])).toEqual([]);
  });
});
