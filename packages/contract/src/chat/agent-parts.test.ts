// AGT-03, AGT-07, LEGAL-03, CHAT-04: схемы данных-частей ответа агента — строгие, график — не больше шести рядов.
import { describe, expect, it } from "vitest";
import {
  ActionResultData,
  AnswerMetadata,
  ChartData,
  ChatAttachment,
  DATA_PARTS,
  LawAnswerData,
} from "./agent-parts.ts";

const decisionId = "0190f0a0-0000-7000-8000-000000000001";

describe("data-chart", () => {
  const chart = {
    kind: "bar",
    title: "Траты по категориям",
    unit: "money",
    currency: "BYN",
    labels: ["Такси", "Кафе"],
    series: [{ name: "Сентябрь", values: [12000, 8050] }],
  };

  it("график с одним рядом проходит", () => {
    expect(ChartData.parse(chart)).toEqual(chart);
  });

  it("семь рядов не проходят: не больше шести", () => {
    const series = Array.from({ length: 7 }, (_, i) => ({ name: `Ряд ${String(i)}`, values: [1] }));
    expect(ChartData.safeParse({ ...chart, series }).success).toBe(false);
  });

  it("лишнее поле не проходит", () => {
    expect(ChartData.safeParse({ ...chart, html: "<b>" }).success).toBe(false);
  });
});

describe("data-action-result", () => {
  it("«Да» несёт токен «Отменить», «Нет» — null", () => {
    const token = "0190f0a0-0000-7000-8000-0000000000aa";
    expect(ActionResultData.parse({ decisionId, status: "yes", undoToken: token }).undoToken).toBe(
      token,
    );
    expect(ActionResultData.parse({ decisionId, status: "no", undoToken: null }).status).toBe("no");
  });

  it("ответ не «да» и не «нет» не проходит", () => {
    expect(
      ActionResultData.safeParse({ decisionId, status: "pending", undoToken: null }).success,
    ).toBe(false);
  });
});

describe("data-law-answer", () => {
  it("ответ с текстом, ссылкой на цитату и пометкой проходит", () => {
    const answer = {
      outcome: "cited",
      parts: [
        { type: "text", text: "Вычет предоставляется " },
        { type: "cite", n: 1 },
      ],
      citations: [
        {
          n: 1,
          kind: "quote",
          versionId: "12.2",
          pravoId: "HK9800166",
          actTitle: "Налоговый кодекс",
          label: "ст. 209",
          path: "НК › Статья 209",
          text: "Текст нормы.",
          edition: "в редакции на 21.10.2026",
          editionOn: "2026-10-21",
          url: "https://pravo.by/document/?guid=3871&p0=HK9800166",
          changedSince: false,
          notes: [],
        },
      ],
      notices: [{ kind: "disclaimer", text: "Не является юридической консультацией." }],
      versionIds: ["12.2"],
    };
    expect(LawAnswerData.parse(answer)).toEqual(answer);
  });

  it("неизвестный вид цитаты не проходит", () => {
    expect(
      LawAnswerData.safeParse({
        outcome: "cited",
        parts: [],
        citations: [{ n: 1, kind: "image" }],
        notices: [],
        versionIds: [],
      }).success,
    ).toBe(false);
  });
});

describe("метаданные ответа и реестр частей", () => {
  it("кто ответил и кто был недоступен", () => {
    expect(
      AnswerMetadata.parse({ answeredBy: { model: "zai/glm", unavailable: ["groq/llama"] } }),
    ).toEqual({ answeredBy: { model: "zai/glm", unavailable: ["groq/llama"] } });
  });

  it("реестр называет четыре вида данных-частей", () => {
    expect(Object.keys(DATA_PARTS)).toEqual([
      "data-law-answer",
      "data-action-result",
      "data-chart",
      "data-attachment",
    ]);
  });
});

describe("CHAT-03: вложение сообщения", () => {
  const id = "0190f0a0-0000-7000-8000-000000000009";

  it("чек и выписка — вид и id; другой вид и лишнее поле не проходят", () => {
    expect(ChatAttachment.parse({ kind: "receipt", id })).toEqual({ kind: "receipt", id });
    expect(ChatAttachment.parse({ kind: "statement", id }).kind).toBe("statement");
    expect(ChatAttachment.safeParse({ kind: "photo", id }).success).toBe(false);
    expect(ChatAttachment.safeParse({ kind: "receipt", id, path: "/etc/passwd" }).success).toBe(
      false,
    );
    expect(ChatAttachment.safeParse({ kind: "receipt", id: "не-uuid" }).success).toBe(false);
  });
});
