// NFR-25: кнопка «Скачать» локальных моделей без работающего worker — свой файл со своим стендом. Раньше этот стенд
// поднимался внутри local-models.int.test.ts, пока стенд файла (api + worker) ещё открыт: файл держал два стенда и две
// тестовые базы разом (≈ вдвое больше соединений) и под нагрузкой make check выбивал max_connections (53300).
import { createTestDb } from "@kosht/testing/db";
import { describe, expect, it } from "vitest";
import { sessionCookie, STACK_PASSWORD, startHttpStack } from "./__fixtures__/http-stack.ts";

describe("NFR-25: кнопка «Скачать» без работающего worker", () => {
  it("ставит ровно одну ожидающую задачу; повторное нажатие не плодит вторую", async () => {
    const lone = await createTestDb();
    const alone = await startHttpStack(lone, { worker: false });
    try {
      const admin = { email: "lone@example.test", password: STACK_PASSWORD };
      await alone.call("local", "/identity/setup", { body: admin });
      const cookie = sessionCookie(await alone.call("local", "/identity/sign-in", { body: admin }));
      for (const _ of [1, 2, 3]) {
        const response = await alone.call("local", "/admin/ai/local-models/download", {
          cookie,
          post: true,
        });
        expect(response.status).toBe(200);
      }
      const { rows } = await lone.owner.query<{ n: string }>(
        "select count(*) as n from pgboss.job where name = 'llm.download-models' and state = 'created'",
      );
      expect(Number(rows[0]?.n)).toBe(1);
    } finally {
      await alone.close();
      await lone.drop();
    }
  });
});
