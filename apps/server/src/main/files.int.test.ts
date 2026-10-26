// SEC-03 сквозь HTTP: свой файл скачивается по id (attachment, тип и имя из метаданных), чужой id — NOT_FOUND, без
// входа — UNAUTHORIZED. Файл кладёт фасад files от имени владельца (приём файлов — T-025).
import { makeScope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FilesFacade } from "../modules/files/index.ts";
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

function files(): FilesFacade {
  const module = stack.api.modules.find((m) => m.id === "files");
  if (module === undefined) throw new Error("нет модуля files");
  return module.facade as FilesFacade;
}

describe("SEC-03: выдача файла только владельцу", () => {
  it("владелец скачивает файл, другой пользователь получает NOT_FOUND, гость — UNAUTHORIZED", async () => {
    const owner = await registerUser(stack, db, "owner@example.test");
    const stranger = await registerUser(stack, db, "stranger@example.test");
    const saved = await files().save(stack.api.platform.scoped(makeScope(owner)), {
      kind: "statement",
      name: "Выписка октябрь.csv",
      mime: "text/csv",
      content: new TextEncoder().encode("дата;сумма\n"),
    });

    const own = await stack.call("local", `/files/${saved.id}`, { cookie: owner.cookie });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("text/csv");
    // Кириллица в filename — подчёркиваниями (ASCII), полное имя — в filename* (RFC 6266).
    expect(own.headers.get("content-disposition")).toBe(
      `attachment; filename="_______ _______.csv"; filename*=utf-8''${encodeURIComponent("Выписка октябрь.csv")}`,
    );
    expect(await own.text()).toBe("дата;сумма\n");

    const foreign = await stack.call("local", `/files/${saved.id}`, { cookie: stranger.cookie });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: "NOT_FOUND" });

    const guest = await stack.call("local", `/files/${saved.id}`);
    expect(guest.status).toBe(401);
  });

  it("id не uuid — VALIDATION, путь к диску не строится", async () => {
    const user = await registerUser(stack, db, "path@example.test");
    const response = await stack.call("local", "/files/..%2F..%2Fetc%2Fpasswd", {
      cookie: user.cookie,
    });
    expect(response.status).toBe(400);
  });
});
