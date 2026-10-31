// AGT-08, ARCHITECTURE §8.2: история для модели — текстом; правовой ответ, итог «Да» и график не теряют нить; вызовы
// инструментов прошлых ответов не уходят; вопрос ask_user и ожидающее подтверждение — остаются.
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { modelHistory, pendingOf, toolNameOf } from "./history.ts";

const user = (id: string, text: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const assistant = (id: string, parts: UIMessage["parts"]): UIMessage => ({
  id,
  role: "assistant",
  parts,
});
const block = "<context>\ntoday: 2026-10-31\n</context>";

async function texts(messages: UIMessage[], window = 10) {
  const result = await modelHistory(messages, { window, contextBlock: block });
  return result.map((m) => ({
    role: m.role,
    text:
      typeof m.content === "string"
        ? m.content
        : m.content.map((part) => ("text" in part ? part.text : "")).join(""),
  }));
}

describe("modelHistory", () => {
  it("вопрос получает блок контекста в конце; прежние сообщения — без него", async () => {
    const result = await texts([
      user("u1", "Сколько на такси в сентябре?"),
      assistant("a1", [{ type: "text", text: "На такси — 120 BYN." }]),
      user("u2", "а в августе?"),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]?.text).toContain("Сколько на такси");
    expect(result[0]?.text).not.toContain("<context>");
    expect(result[2]?.text).toContain("а в августе?");
    expect(result[2]?.text).toContain("today: 2026-10-31");
  });

  it("вызовы инструментов прошлых ответов не уходят, текст ответа — да", async () => {
    const result = await texts([
      user("u1", "счета"),
      assistant("a1", [
        {
          type: "tool-list_accounts",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { items: [] },
        } as never,
        { type: "text", text: "Вот ваши счета." },
      ]),
      user("u2", "ещё раз"),
    ]);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(result[1]?.text).toBe("Вот ваши счета.");
  });

  it("правовой ответ — текстом со ссылками на нормы в скобках: «а по ст. 210?» не теряет нить", async () => {
    const data = {
      outcome: "cited",
      parts: [
        { type: "text", text: "Вычет предоставляется " },
        { type: "cite", n: 1 },
        { type: "text", text: "." },
      ],
      citations: [
        {
          n: 1,
          kind: "link",
          reason: "named",
          pravoId: "HK9800166",
          actTitle: "Налоговый кодекс",
          label: "ст. 209",
          url: "https://pravo.by/x",
          note: "n",
        },
      ],
      notices: [],
      versionIds: [],
    };
    const result = await texts([
      user("u1", "вычет?"),
      assistant("a1", [{ type: "data-law-answer", data } as never]),
      user("u2", "а подробнее?"),
    ]);
    expect(result[1]?.text).toBe("Вычет предоставляется [ст. 209].");
  });

  it("ask_user — «вы спросили», ожидающее подтверждение — «ждёт да/нет» без id решения", async () => {
    const result = await texts([
      user("u1", "купил квартиру"),
      assistant("a1", [
        {
          type: "tool-ask_user",
          toolCallId: "c1",
          state: "input-available",
          input: { factKey: "housingQueue", question: "Вы состояли на учёте?" },
        } as never,
      ]),
      user("u2", "удали вчерашнее"),
      assistant("a2", [
        {
          type: "tool-delete_transaction",
          toolCallId: "c2",
          state: "output-available",
          input: {},
          output: { ok: true, pending: { decisionId: "d-secret", count: 3 } },
        } as never,
      ]),
      user("u3", "нет, только одну"),
    ]);
    expect(result[1]?.text).toContain("You asked the user: Вы состояли на учёте?");
    expect(result[3]?.text).toContain("delete_transaction, 3 item(s)");
    expect(JSON.stringify(result)).not.toContain("d-secret");
  });

  it("итог «Да» и график — короткими пометками", async () => {
    const result = await texts([
      user("u1", "удали"),
      assistant("a1", [
        { type: "data-action-result", data: { status: "yes" } } as never,
        { type: "data-chart", data: { title: "Траты по категориям" } } as never,
      ]),
      user("u2", "спасибо"),
    ]);
    expect(result[1]?.text).toContain("confirmed");
    expect(result[1]?.text).toContain("Траты по категориям");
  });

  it("окно: только последние N сообщений, и история начинается с вопроса пользователя", async () => {
    const result = await texts(
      [
        user("u1", "первый"),
        assistant("a1", [{ type: "text", text: "ответ 1" }]),
        user("u2", "второй"),
        assistant("a2", [{ type: "text", text: "ответ 2" }]),
        user("u3", "третий"),
      ],
      3,
    );
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(result[0]?.text).toContain("второй");
  });

  it("пустые ответы (оборванные, «идёт») не попадают в историю", async () => {
    const result = await texts([user("u1", "раз"), assistant("a1", []), user("u2", "два")]);
    expect(result.map((m) => m.role)).toEqual(["user", "user"]);
  });

  it("последнее сообщение — не вопрос пользователя: ошибка программы", async () => {
    await expect(
      modelHistory([assistant("a1", [{ type: "text", text: "x" }])], {
        window: 5,
        contextBlock: block,
      }),
    ).rejects.toThrow(/вопрос пользователя/u);
  });
});

describe("разбор частей", () => {
  it("toolNameOf и pendingOf", () => {
    const part = {
      type: "tool-delete_account",
      output: { ok: true, pending: { decisionId: "d1", count: 1 } },
    } as never;
    expect(toolNameOf(part)).toBe("delete_account");
    expect(pendingOf(part)).toEqual({ decisionId: "d1", count: 1 });
    expect(toolNameOf({ type: "text", text: "x" })).toBeUndefined();
    expect(
      pendingOf({ type: "tool-x", output: { ok: false, code: "NOT_FOUND" } } as never),
    ).toBeUndefined();
  });
});
