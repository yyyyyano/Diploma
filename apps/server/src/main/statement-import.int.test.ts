// STMT-03, STMT-04, STMT-11, NFR-21 сквозь HTTP и настоящий worker: загрузка файла → разбор в очереди → предпросмотр →
// «Импортировать» → откат; чужой импорт недоступен. Модели в тесте — тестовый провайдер без ответов: категорию, которую
// правила не покрыли, он оставляет «Прочим», разбор колонок по словарю модели не требует.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

const csv = () =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../../datasets/statements/lesbank-csv-september/statement.csv",
          import.meta.url,
        ),
      ),
    ),
  );

async function upload(cookie: string): Promise<string> {
  const form = new FormData();
  form.set("kind", "statement");
  form.set("files[0]", new File([csv()], "сентябрь.csv", { type: "text/csv" }));
  const response = await stack.call("local", "/files", { cookie, form });
  expect(response.status).toBe(200);
  const { files } = (await response.json()) as { files: { id: string }[] };
  return files[0]?.id ?? "";
}

describe("STMT-04: импорт выписки через API", () => {
  it("start → разбор в очереди → предпросмотр → confirm → откат", async () => {
    const user = await registerUser(stack, db, "import-flow@example.test");
    const fileId = await upload(user.cookie);
    const started = await stack.call("local", "/statements/imports", {
      cookie: user.cookie,
      body: { fileId },
    });
    expect(started.status).toBe(200);
    const { id } = (await started.json()) as { id: string };

    // Разбор идёт в worker: ждём готового предпросмотра.
    const detail = await vi.waitFor(
      async () => {
        const response = await stack.call("local", `/statements/imports/${id}`, {
          cookie: user.cookie,
        });
        const body = (await response.json()) as { summary: { status: string } };
        if (body.summary.status !== "ready") throw new Error(body.summary.status);
        return body as {
          summary: {
            found: number;
            newCount: number;
            duplicates: number;
            bank: string;
            mask: string;
          };
          rows: { description: string; amount: { minor: number } }[];
          columns: { header: string[] } | null;
        };
      },
      { timeout: 30_000, interval: 250 },
    );
    expect(detail.summary).toMatchObject({
      found: 30,
      newCount: 30,
      duplicates: 0,
      bank: "Лесбанк",
      mask: "4821",
    });
    expect(detail.rows).toHaveLength(5);
    expect(detail.columns?.header[0]).toBe("Дата");

    const confirmed = await stack.call("local", `/statements/imports/${id}/confirm`, {
      cookie: user.cookie,
      post: true,
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ imported: 30, duplicates: 0, decisionId: null });
    const listed = (await (
      await stack.call("local", "/statements/imports", { cookie: user.cookie })
    ).json()) as { items: { id: string; status: string }[] };
    expect(listed.items).toMatchObject([{ id, status: "imported" }]);
    const operations = await db.owner.query<{ n: string }>(
      "select count(*)::text as n from transactions where household_id = $1 and source = 'statement'",
      [user.householdId],
    );
    expect(operations.rows[0]?.n).toBe("30");

    const info = await stack.call("local", `/statements/imports/${id}/rollback`, {
      cookie: user.cookie,
    });
    expect(await info.json()).toEqual({ transactions: 30, edited: 0 });
    const rolled = await stack.call("local", `/statements/imports/${id}/rollback`, {
      cookie: user.cookie,
      post: true,
    });
    expect(await rolled.json()).toEqual({ status: "undone" });
    const left = await db.owner.query<{ n: string }>(
      "select count(*)::text as n from transactions where household_id = $1",
      [user.householdId],
    );
    expect(left.rows[0]?.n).toBe("0");
  }, 60_000);

  it("чужой импорт — NOT_FOUND; без входа — 401; «Отмена» удаляет черновик и файл", async () => {
    const owner = await registerUser(stack, db, "import-owner@example.test");
    const stranger = await registerUser(stack, db, "import-stranger@example.test");
    const fileId = await upload(owner.cookie);
    const { id } = (await (
      await stack.call("local", "/statements/imports", { cookie: owner.cookie, body: { fileId } })
    ).json()) as { id: string };
    expect(
      (await stack.call("local", `/statements/imports/${id}`, { cookie: stranger.cookie })).status,
    ).toBe(404);
    expect((await stack.call("local", `/statements/imports/${id}`)).status).toBe(401);
    const strangerStart = await stack.call("local", "/statements/imports", {
      cookie: stranger.cookie,
      body: { fileId },
    });
    expect(strangerStart.status).toBe(404);
    const cancelled = await stack.call("local", `/statements/imports/${id}/cancel`, {
      cookie: owner.cookie,
      post: true,
    });
    expect(cancelled.status).toBe(200);
    expect((await stack.call("local", `/files/${fileId}`, { cookie: owner.cookie })).status).toBe(
      404,
    );
  }, 30_000);
});
