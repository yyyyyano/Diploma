// T-028, NFR-11: тестовый провайдер читает чек по схеме receipt.extract — один и тот же синтетический чек, офлайн; на
// перепроверку отвечает «ничего не меняю», на прочие схемы — «{}».
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { createTestProvider, SYNTHETIC_RECEIPT } from "./test-provider.ts";

async function answer(properties: readonly string[]): Promise<unknown> {
  const model = createTestProvider().languageModel("scripted");
  const call: LanguageModelV4CallOptions = {
    prompt: [{ role: "user", content: [{ type: "text", text: "документ" }] }],
    responseFormat: {
      type: "json",
      schema: {
        type: "object",
        properties: Object.fromEntries(properties.map((key) => [key, {}])),
      },
    },
  };
  const result = await model.doGenerate(call);
  const first = result.content[0];
  return first?.type === "text" ? JSON.parse(first.text) : undefined;
}

describe("тестовая модель: чтение чека", () => {
  it("по схеме receipt.extract (store, items, total…) — синтетический чек; его форму сверяет e2e «фото чека → карточка»", async () => {
    expect(await answer(["store", "unp", "items", "receiptDiscount", "total", "uid"])).toEqual(
      SYNTHETIC_RECEIPT,
    );
  });

  it("по схеме перепроверки (lines, total, receiptDiscount) — «ничего не меняю»", async () => {
    expect(await answer(["lines", "total", "receiptDiscount"])).toEqual({
      lines: [],
      total: null,
      receiptDiscount: null,
    });
  });

  it("по любой другой схеме — «{}»", async () => {
    expect(await answer(["columns"])).toEqual({});
  });
});
