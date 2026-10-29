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

/** multipart как у сайта: поле kind и файлы files[0], files[1]…. */
function uploadForm(kind: string, files: readonly { name: string; bytes: Uint8Array }[]): FormData {
  const form = new FormData();
  form.set("kind", kind);
  for (const [index, file] of files.entries()) {
    // Заявленный браузером тип подделать проще всего — сервер его не слушает.
    form.set(`files[${index}]`, new File([file.bytes], file.name, { type: "application/pdf" }));
  }
  return form;
}

const text = (value: string) => new TextEncoder().encode(value);
const PDF = text(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);
/** Сигнатура PNG и остаток: file-type узнаёт её по первым байтам. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);
/** Заголовок исполняемого файла Windows: «MZ» и нули. */
const EXE = new Uint8Array([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
]);

describe("SEC-03, STMT-03: приём файлов", () => {
  it("PDF и CSV принимаются как выписки: тип — по содержимому, файл скачивается владельцем", async () => {
    const user = await registerUser(stack, db, "upload-ok@example.test");
    const response = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("statement", [
        { name: "Выписка.pdf", bytes: PDF },
        { name: "операции.csv", bytes: text("Дата;Сумма\n01.10.2026;-12,50\n") },
      ]),
    });
    expect(response.status).toBe(200);
    const { files } = (await response.json()) as {
      files: { id: string; mime: string; name: string }[];
    };
    expect(files.map((f) => [f.name, f.mime])).toEqual([
      ["Выписка.pdf", "application/pdf"],
      ["операции.csv", "text/csv"],
    ]);
    const first = files[0];
    if (first === undefined) throw new Error("нет файла");
    const download = await stack.call("local", `/files/${first.id}`, { cookie: user.cookie });
    expect(download.headers.get("content-type")).toBe("application/pdf");
  });

  it("исполняемый файл под именем .pdf отклоняется как неподходящий тип", async () => {
    const user = await registerUser(stack, db, "upload-exe@example.test");
    const response = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("statement", [{ name: "выписка.pdf", bytes: EXE }]),
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
  });

  it("PNG под именем .pdf — подменённое расширение, отклоняется", async () => {
    const user = await registerUser(stack, db, "upload-png@example.test");
    const response = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("statement", [{ name: "выписка.pdf", bytes: PNG }]),
    });
    expect(response.status).toBe(415);
  });

  it("один плохой файл из двух: ничего не сохраняется, хороший тоже", async () => {
    const user = await registerUser(stack, db, "upload-atomic@example.test");
    const scope = makeScope(user);
    const response = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("statement", [
        { name: "хорошая.pdf", bytes: PDF },
        { name: "плохая.pdf", bytes: EXE },
      ]),
    });
    expect(response.status).toBe(415);
    const { rows } = await db.owner.query<{ n: string }>(
      "select count(*)::text as n from files where household_id = $1",
      [scope.householdId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("фото чека не принимает PDF, а принимает PNG", async () => {
    const user = await registerUser(stack, db, "upload-photo@example.test");
    const bad = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("receipt-photo", [{ name: "чек.pdf", bytes: PDF }]),
    });
    expect(bad.status).toBe(415);
    const good = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("receipt-photo", [{ name: "чек.png", bytes: PNG }]),
    });
    expect(good.status).toBe(200);
  });

  it("11 файлов за раз — TOO_MANY_FILES (предел — настройка, по умолчанию 10)", async () => {
    const user = await registerUser(stack, db, "upload-many@example.test");
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `чек${i}.png`, bytes: PNG }));
    const response = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("receipt-photo", many),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "TOO_MANY_FILES" });
  });

  it("выписка больше 25 МБ и фото больше 15 МБ — FILE_TOO_LARGE", async () => {
    const user = await registerUser(stack, db, "upload-big@example.test");
    const csv = new Uint8Array(25 * 1024 * 1024 + 1).fill(0x61);
    const bigStatement = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("statement", [{ name: "большая.csv", bytes: csv }]),
    });
    expect(bigStatement.status).toBe(413);
    expect(await bigStatement.json()).toMatchObject({ code: "FILE_TOO_LARGE" });
    const photo = new Uint8Array(15 * 1024 * 1024 + 1);
    photo.set(PNG);
    const bigPhoto = await stack.call("local", "/files", {
      cookie: user.cookie,
      form: uploadForm("receipt-photo", [{ name: "большое.png", bytes: photo }]),
    });
    expect(await bigPhoto.json()).toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("без входа — UNAUTHORIZED, ни один файл не принят", async () => {
    const response = await stack.call("local", "/files", {
      form: uploadForm("statement", [{ name: "a.pdf", bytes: PDF }]),
    });
    expect(response.status).toBe(401);
  });
});
