// CHAT-01, CHAT-02: порядок сообщений диалога. Вопрос и строка ответа «идёт» пишутся одной транзакцией, а `now()` в Postgres — время
// начала транзакции: у обеих строк одинаковый `created_at`, и порядок решал бы случайный id ответа (v4 против v7 вопроса). Тест
// воспроизводит худший случай — id ответа меньше любого другого: вопрос всё равно идёт первым, ответ — последним.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../../platform/db/scoped-db.ts";
import { createConversation, insertMessage, listMessages } from "./chat.repo.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("порядок сообщений диалога в одной транзакции", () => {
  it("ответ с наименьшим возможным id всё равно после вопроса: порядок — по времени записи, а не по случайному id", async () => {
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    const lowest = "00000000-0000-4000-8000-000000000000";
    const conversationId = await s.transaction(async (tx) => {
      const id = await createConversation(tx, null);
      await insertMessage(tx, {
        conversationId: id,
        role: "user",
        parts: [{ type: "text", text: "Что в чеке?" }],
        status: "complete",
      });
      await insertMessage(tx, {
        id: lowest,
        conversationId: id,
        role: "assistant",
        parts: [],
        status: "streaming",
      });
      return id;
    });
    const rows = await listMessages(s, conversationId);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows.at(-1)?.id).toBe(lowest);
  });
});
