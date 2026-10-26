// AUTH-06: строки локального ящика на Postgres — письмо без кнопки и пометки читается без этих полей, а не с null.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { insertMail, listMail } from "./mail.repo.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("mail_messages", () => {
  it("письмо без кнопки и пометки — без полей action и note; с ними — поля на месте", async () => {
    const system = createSystemDb(db.pool);
    const plain = {
      to: "plain@example.test",
      subject: "Тестовое письмо",
      preview: "Отправка работает",
      title: "Почта работает",
      paragraphs: ["Абзац"],
    };
    await insertMail(system, plain, new Date("2026-10-26T09:00:00Z"));
    await insertMail(
      system,
      {
        ...plain,
        to: "full@example.test",
        action: { label: "Открыть", url: "http://127.0.0.1:8140/x" },
        note: { kind: "warn", text: "Ссылка действует 1 ч." },
      },
      new Date("2026-10-26T09:01:00Z"),
    );
    const [full, first] = await listMail(system);
    expect(first).toEqual({
      ...plain,
      id: expect.any(String),
      sentAt: new Date("2026-10-26T09:00:00Z"),
    });
    expect(full).toMatchObject({
      to: "full@example.test",
      action: { label: "Открыть", url: "http://127.0.0.1:8140/x" },
      note: { kind: "warn", text: "Ссылка действует 1 ч." },
    });
  });
});
