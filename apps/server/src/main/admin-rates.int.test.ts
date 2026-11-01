// ADM-11, TAX-03, LAW-33 сквозь HTTP и корень композиции (api + worker, страницы pravo.by — из папки сохранённых, без сети): вкладка
// «Таблица ставок» — только администратору; начальное наполнение с источниками и «подтверждено разработчиком»; предложить значение за
// прошлый год и «Подтвердить»; а главное — настоящая новая редакция НК с другим числом в п. 1.1 ст. 209 помечает ставку расхождением и
// шлёт уведомление администратору, сама ставка не меняется.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  registerUser,
  sessionCookie,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

const FIXTURES = fileURLToPath(
  new URL("../modules/legal-base/__fixtures__/pravo-by", import.meta.url),
);

interface Row {
  id: string;
  param: string;
  status: string;
  value: number;
  validFrom: string;
  drift: boolean;
  source: { act: string | null; article: string | null; point: string | null; linked: boolean };
  confirmed: { by: string; on: string } | null;
}
interface Table {
  items: Row[];
  counts: { pending: number; drift: number };
}

let db: TestDb;
let stack: HttpStack;
let dir: string;
let root: string;
beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-rates-"));
  await cp(FIXTURES, dir, { recursive: true });
  stack = await startHttpStack(db, {
    env: { LEGAL_SOURCE: "fixtures", LEGAL_FIXTURES_DIR: dir, LLM_MODELS_DOWNLOAD: "0" },
  });
  const admin = { email: "root@example.test", password: STACK_PASSWORD };
  const setup = await stack.call("local", "/identity/setup", { body: admin });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  root = sessionCookie(await stack.call("local", "/identity/sign-in", { body: admin }));
  // Стартовый каталог (с НК) загружен: ставки сверять есть с чем.
  await vi.waitFor(
    async () => {
      const response = await stack.call("local", "/legal-base/startup-progress");
      const progress = (await response.json()) as { state: string };
      if (progress.state !== "ready") throw new Error("каталог ещё загружается");
    },
    { timeout: 30_000, interval: 300 },
  );
});
afterAll(async () => {
  await stack.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

const table = async (): Promise<Table> =>
  (await (await stack.call("local", "/admin/rates", { cookie: root })).json()) as Table;
const post = (path: string, body: unknown) => stack.call("local", path, { cookie: root, body });
const rowOf = async (param: string, status = "confirmed") =>
  (await table()).items.find((r) => r.param === param && r.status === status);

describe("ADM-11: доступ", () => {
  it("обычный пользователь и гость не открывают ни одной процедуры таблицы ставок", async () => {
    const user = await registerUser(stack, db, "plain@example.test");
    const calls: [string, unknown][] = [
      ["/admin/rates", undefined],
      [
        "/admin/rates/propose",
        {
          param: "ndfl.rate.base",
          validFrom: "2027-01-01",
          validTo: null,
          value: 1,
          sourceAct: null,
          sourceArticle: null,
          sourcePoint: null,
          sourceUrl: "https://example.test",
        },
      ],
      ["/admin/rates/confirm", { id: "01990000-0000-7000-8000-000000000000" }],
      ["/admin/rates/reject", { id: "01990000-0000-7000-8000-000000000000" }],
    ];
    for (const [path, body] of calls) {
      const input = body === undefined ? {} : { body };
      const asUser = await stack.call("local", path, { cookie: user.cookie, ...input });
      const asGuest = await stack.call("local", path, input);
      expect([path, asUser.status, asGuest.status]).toEqual([path, 403, 401]);
    }
  });
});

describe("TAX-03, ADM-11: таблица и подтверждение", () => {
  it("вычеты ст. 209 и ставки ст. 214 — подтверждены разработчиком с источником; взнос ФСЗН и ПДН ждут «Подтвердить»", async () => {
    const t = await table();
    expect(await rowOf("ndfl.std-deduction.base")).toMatchObject({
      value: 21_600,
      confirmed: { by: "developer", on: "2026-10-30" },
      source: { act: "Hk0900071", article: "209", point: "1.1" },
    });
    expect(await rowOf("ndfl.rate.base")).toMatchObject({
      value: 1300,
      confirmed: { by: "developer", on: "2026-11-01" },
    });
    expect(await rowOf("fszn.employee-rate", "pending")).toMatchObject({
      value: 100,
      confirmed: null,
    });
    expect(t.counts.pending).toBeGreaterThan(0);
  });

  it("значение за прошлый год: предложено — ждёт, «Подтвердить» — вступает в силу с отметкой администратора", async () => {
    const proposed = await post("/admin/rates/propose", {
      param: "ndfl.std-deduction.child",
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
      value: 5800,
      sourceAct: "Hk0900071",
      sourceArticle: "209",
      sourcePoint: "1.2",
      sourceUrl: null,
    });
    expect(proposed.status).toBe(200);
    const id =
      (await table()).items.find(
        (r) => r.param === "ndfl.std-deduction.child" && r.validFrom === "2025-01-01",
      )?.id ?? "";
    expect((await rowOf("ndfl.std-deduction.child", "pending"))?.value).toBe(5800);
    const confirmed = await post("/admin/rates/confirm", { id });
    expect(confirmed.status).toBe(200);
    expect((await table()).items.find((r) => r.id === id)).toMatchObject({
      status: "confirmed",
      confirmed: { by: "admin" },
    });
    expect((await post("/admin/rates/confirm", { id })).status).toBe(404);
  });

  it("неверный ввод — 400 с названием поля; «Отклонить» убирает ожидающее значение", async () => {
    const bad = await post("/admin/rates/propose", {
      param: "ndfl.rate.base",
      validFrom: "2027-01-01",
      validTo: null,
      value: 1300,
      sourceAct: null,
      sourceArticle: null,
      sourcePoint: null,
      sourceUrl: null,
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ data: { params: { field: "source" } } });

    await post("/admin/rates/propose", {
      param: "ndfl.rate.base",
      validFrom: "2027-01-01",
      validTo: null,
      value: 1300,
      sourceAct: "Hk0900071",
      sourceArticle: "214",
      sourcePoint: null,
      sourceUrl: null,
    });
    const id =
      (await table()).items.find(
        (r) => r.param === "ndfl.rate.base" && r.validFrom === "2027-01-01",
      )?.id ?? "";
    expect((await post("/admin/rates/reject", { id })).status).toBe(200);
    expect((await table()).items.some((r) => r.id === id)).toBe(false);
  });
});

describe("LAW-33: стартовая загрузка каталога", () => {
  it("на свежей установке источники ставок и сроков привязаны к версиям фрагментов без единой смены редакции", async () => {
    // T-048: первая загрузка акта сообщает `act-updated` — сверка не ждёт первой смены редакции закона.
    await vi.waitFor(
      async () => {
        for (const param of [
          "ndfl.std-deduction.base",
          "deadline.property-tax",
          "deadline.land-tax",
          "deadline.transport-tax",
          "deadline.npd-payment",
          "deadline.declaration",
        ]) {
          const row = await rowOf(param);
          expect([param, row?.source.linked, row?.drift]).toEqual([param, true, false]);
        }
      },
      { timeout: 60_000, interval: 300 },
    );
  }, 90_000);
});

describe("LAW-33: новая редакция закона с другим числом", () => {
  it("в п. 1.1 ст. 209 вместо 216 стало 2300 — ставка помечена расхождением, администратор уведомлён, значение не изменилось", async () => {
    const before = await rowOf("ndfl.std-deduction.base");
    expect(before?.drift).toBe(false);
    const file = join(dir, "Hk0900071.html");
    const html = await readFile(file, "utf8");
    expect(html).toContain("в размере 216 белорусских рублей в месяц");
    await writeFile(
      file,
      html.replace(
        "в размере 216 белорусских рублей в месяц",
        "в размере 2300 белорусских рублей в месяц",
      ),
    );

    const run = await stack.call("local", "/admin/laws/check-now", { cookie: root, post: true });
    expect(run.status).toBe(200);

    await vi.waitFor(
      async () => expect((await rowOf("ndfl.std-deduction.base"))?.drift).toBe(true),
      {
        timeout: 60_000,
        interval: 300,
      },
    );
    const after = await rowOf("ndfl.std-deduction.base");
    expect(after).toMatchObject({ value: 21_600, drift: true });
    // Остальные вычеты ст. 209 на месте: число 63, 120, 306, 860 в тексте есть.
    expect((await rowOf("ndfl.std-deduction.child"))?.drift).toBe(false);
    // T-045: числа ставок ст. 214 и 381² тоже найдены в тексте своего пункта — источник привязан к версии фрагмента, расхождения нет.
    // Сверка идёт по строкам по очереди: когда помечена ст. 209, остальные могут ещё ждать своей очереди — ждём, а не гадаем.
    await vi.waitFor(
      async () => {
        for (const param of [
          "ndfl.rate.base",
          "ndfl.rate.high-from",
          "ip.rate.high-from",
          "npd.rate.high-from",
        ]) {
          const row = await rowOf(param);
          expect([param, row?.source.linked, row?.drift]).toEqual([param, true, false]);
        }
      },
      { timeout: 60_000, interval: 300 },
    );
    // Значение 2025 года (5800) в сверке не участвует: действующая редакция отвечает за числа сегодняшнего периода.
    expect(
      (await table()).items.find((r) => r.validFrom === "2025-01-01" && r.status === "confirmed")
        ?.drift,
    ).toBe(false);
    expect((await table()).counts.drift).toBe(1);
    const notes = await db.owner.query<{ kind: string }>(
      "select kind from admin_notifications where kind = 'rates-mismatch'",
    );
    expect(notes.rows).toEqual([{ kind: "rates-mismatch" }]);
  }, 90_000);
});
