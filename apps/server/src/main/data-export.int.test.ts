// PRIV-05 сквозь HTTP, корень композиции и настоящий worker: «Подготовить архив» → задача privacy.build-export
// собирает ZIP → вкладка видит «готов» → архив скачивается владельцем (files.download), другой пользователь получает
// NOT_FOUND; подписка notifications присылает владельцу одно уведомление «архив готов». Тест полноты выгрузки: в архиве есть JSON каждой userOwnedTable реестра — у каждой пользовательской
// таблицы есть строка экспорта (строка удаления — account-deletion.int.test.ts).
import { readZip } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadProductionSchemas } from "../platform/db/__fixtures__/production-schemas.ts";
import { registeredTables } from "../platform/db/tables.ts";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
  await loadProductionSchemas();
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

interface ExportState {
  readonly status: string;
  readonly file: { readonly id: string; readonly name: string; readonly size: number } | null;
}

async function exportState(cookie: string): Promise<ExportState> {
  const response = await stack.call("local", "/privacy/export", { cookie });
  expect(response.status).toBe(200);
  return (await response.json()) as ExportState;
}

describe("PRIV-05: архив «Мои данные» сквозь HTTP и worker", () => {
  it("архив собирается задачей, скачивается владельцем и содержит JSON каждой пользовательской таблицы", async () => {
    const owner = await registerUser(stack, db, "owner@example.test");
    const stranger = await registerUser(stack, db, "stranger@example.test");

    const requested = await stack.call("local", "/privacy/export", {
      cookie: owner.cookie,
      post: true,
    });
    expect(requested.status).toBe(200);
    expect(await requested.json()).toMatchObject({ status: "pending", file: null });

    const ready = await vi.waitFor(
      async () => {
        const state = await exportState(owner.cookie);
        expect(state.status).toBe("ready");
        return state;
      },
      { timeout: 20_000, interval: 100 },
    );
    const file = ready.file;
    if (file === null) throw new Error("у готового архива нет файла");
    expect(file.name).toMatch(/^kosht-my-data-\d{4}-\d{2}-\d{2}\.zip$/);

    const download = await stack.call("local", `/files/${file.id}`, { cookie: owner.cookie });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.byteLength).toBe(file.size);
    const entries = await readZip(bytes);

    const userTables = [...registeredTables()]
      .filter(([, kind]) => kind === "user")
      .map(([name]) => name)
      .toSorted();
    const exported = [...entries.keys()]
      .filter((path) => path.startsWith("data/"))
      .map((path) => path.replace(/^data\/[^/]+\//, "").replace(/\.json$/, ""))
      .toSorted();
    expect(exported).toEqual(userTables);
    // Данные владельца в архиве: согласия регистрации.
    const consents = JSON.parse(
      new TextDecoder().decode(entries.get("data/privacy/privacy_consents.json")),
    ) as { userId: string }[];
    expect(consents.map((row) => row.userId)).toEqual([owner.userId, owner.userId]);

    // NOTIF-02: уведомление о готовности — одно, со ссылкой на архив; у другого пользователя его нет.
    const notices = await vi.waitFor(
      async () => {
        const feed = (await (
          await stack.call("local", "/notifications", { cookie: owner.cookie })
        ).json()) as { items: { kind: string; objectRef: unknown }[] };
        expect(feed.items.length).toBeGreaterThan(0);
        return feed.items;
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(notices.filter((n) => n.kind === "data-export-ready")).toEqual([
      expect.objectContaining({ objectRef: { entity: "data-export", id: expect.any(String) } }),
    ]);
    const strangerFeed = (await (
      await stack.call("local", "/notifications", { cookie: stranger.cookie })
    ).json()) as { items: unknown[] };
    expect(strangerFeed.items).toEqual([]);

    const foreign = await stack.call("local", `/files/${file.id}`, { cookie: stranger.cookie });
    expect(foreign.status).toBe(404);
    expect(await exportState(stranger.cookie)).toMatchObject({ status: "none", file: null });
  });
});
