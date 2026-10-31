// NFR-25, AUTH-10, ADM-50 сквозь HTTP и корень композиции: прогресс скачивания локальных моделей (без входа, только с
// этого компьютера), админка «Локальные модели» (только админ), кнопка «Скачать» ставит одну задачу, первый запуск
// системы сам ставит скачивание. Сами модели в тестах не качаются (LLM_MODELS_DOWNLOAD=0, NFR-11).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  registerUser,
  sessionCookie,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
let root: string;
beforeAll(async () => {
  db = await createTestDb();
  // llama-server «не запущен»: порт 1 никто не слушает — самотест отвечает «сервис не запущен», а не зависит от машины.
  stack = await startHttpStack(db, { env: { LLAMA_BASE_URL: "http://127.0.0.1:1/v1" } });
  const admin = { email: "root@example.test", password: STACK_PASSWORD };
  const setup = await stack.call("local", "/identity/setup", { body: admin });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  root = sessionCookie(await stack.call("local", "/identity/sign-in", { body: admin }));
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

const jobs = async (name: string) =>
  Number(
    (
      await db.owner.query<{ n: string }>("select count(*) as n from pgboss.job where name = $1", [
        name,
      ])
    ).rows[0]?.n ?? 0,
  );

describe("NFR-25, AUTH-10: прогресс скачивания на экране первого запуска", () => {
  it("с этого компьютера, без входа: состояние и байты, имён файлов нет", async () => {
    const response = await stack.call("local", "/llm/local-models-progress");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual(["bytesDone", "bytesTotal", "state"]);
    expect(body).toMatchObject({ state: "absent", bytesDone: 0 });
    expect(body["bytesTotal"]).toBeGreaterThan(4_000_000_000);
  });

  it("с сетевого входа — «нет такой страницы» (localOnly, R40)", async () => {
    expect((await stack.call("lan", "/llm/local-models-progress")).status).toBe(404);
  });

  it("первый запуск системы сам ставит задачу скачивания моделей (identity.system-initialized)", async () => {
    await expect
      .poll(() => jobs("llm.download-models"), { timeout: 15_000, interval: 300 })
      .toBeGreaterThanOrEqual(1);
  });
});

describe("ADM-50: «Локальные модели» в админке", () => {
  it("обычному пользователю — FORBIDDEN, без входа — 401", async () => {
    const user = await registerUser(stack, db, "models-plain@example.test");
    for (const [path, post] of [
      ["/admin/ai/local-models", false],
      ["/admin/ai/local-models/download", true],
      ["/admin/ai/local-models/self-test", true],
    ] as const) {
      const response = await stack.call("local", path, { cookie: user.cookie, post });
      expect([path, response.status]).toEqual([path, 403]);
    }
    expect((await stack.call("local", "/admin/ai/local-models")).status).toBe(401);
  });

  it("администратор видит набор: чат, эмбеддинги, речь, NER — «нет»; самотест не запускался", async () => {
    const response = await stack.call("local", "/admin/ai/local-models", { cookie: root });
    expect(response.status).toBe(200);
    const view = (await response.json()) as {
      state: string;
      models: { id: string; state: string; files: { path: string }[] }[];
      selfTest: { state: string };
    };
    expect(view.state).toBe("absent");
    expect(view.models.map((model) => model.id)).toEqual([
      "qwen3.5-4b",
      "bge-m3",
      "whisper-large-v3-turbo",
      "ner-ru",
    ]);
    expect(view.models.every((model) => model.state === "absent")).toBe(true);
    expect(view.selfTest.state).toBe("unknown");
  });

  it("«Проверить модели» без llama-server — «сервис не запущен», запасной режим не включается", async () => {
    const response = await stack.call("local", "/admin/ai/local-models/self-test", {
      cookie: root,
      post: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      selfTest: { state: "down", problem: "LLAMA_DOWN", cpuFallback: false },
    });
  });
});
