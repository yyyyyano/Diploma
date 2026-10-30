// AUTH-10, LAW-10, LAW-36 сквозь HTTP и корень композиции (api + worker на настоящих очереди и БД): первый запуск сам
// сохраняет контакт загрузчика и загружает стартовый каталог из сохранённых страниц — без участия человека и без сети
// (LEGAL_SOURCE=fixtures, NFR-11); прогресс виден до входа и только с этого компьютера; контакт — в настройке, не в событии.
import { fileURLToPath } from "node:url";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpStack, STACK_PASSWORD, type HttpStack } from "./__fixtures__/http-stack.ts";

const FIXTURES = fileURLToPath(
  new URL("../modules/legal-base/__fixtures__/pravo-by", import.meta.url),
);

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db, {
    env: {
      LEGAL_SOURCE: "fixtures",
      LEGAL_FIXTURES_DIR: FIXTURES,
      LLM_MODELS_DOWNLOAD: "0",
    },
  });
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

async function progress() {
  const response = await stack.call("local", "/legal-base/startup-progress");
  expect(response.status).toBe(200);
  return (await response.json()) as {
    state: string;
    done: number;
    total: number;
    problems: number;
    stopReason: string | null;
  };
}

describe("AUTH-10, LAW-10: стартовый каталог после первого запуска", () => {
  it("до первого запуска каталога нет — «ждём»; с сетевого входа страницы нет (R40)", async () => {
    expect(await progress()).toMatchObject({ state: "waiting", total: 0 });
    expect((await stack.call("lan", "/legal-base/startup-progress")).status).toBe(404);
  });

  it("после создания администратора акты загружаются сами, контакт — в настройке, в событии его нет", async () => {
    const contact = "https://example.test/operator";
    const setup = await stack.call("local", "/identity/setup", {
      body: { email: "root@example.test", password: STACK_PASSWORD, loaderContact: contact },
    });
    expect(setup.status).toBe(200);
    await expect
      .poll(async () => (await progress()).state, { timeout: 30_000, interval: 300 })
      .toBe("ready");
    expect(await progress()).toMatchObject({ done: 28, total: 28, problems: 0, stopReason: null });
    const stored = await db.owner.query<{ value: unknown }>(
      "select value from settings where key = 'legal-base.loader-contact'",
    );
    expect(stored.rows[0]?.value).toBe(contact);
    const jobs = await db.owner.query<{ data: unknown }>(
      "select data from pgboss.job where name like 'evt.%' or name like 'legal-base.%'",
    );
    expect(JSON.stringify(jobs.rows)).not.toContain(contact);
    const acts = await db.owner.query<{
      pravo_id: string;
      load_state: string;
      article_count: number | null;
    }>(
      "select pravo_id, load_state, article_count from legal_acts where load_state = 'loaded' order by pravo_id",
    );
    expect(acts.rows).toEqual([
      { pravo_id: "C21300569", load_state: "loaded", article_count: 12 },
      { pravo_id: "H10200090", load_state: "loaded", article_count: 51 },
      { pravo_id: "Hk0900071", load_state: "loaded", article_count: 7 },
    ]);
  });

  it("задача пережила бы перезапуск: загрузка записана в журнал фоновых задач как завершённая", async () => {
    const runs = await db.owner.query<{ status: string }>(
      "select status from background_job_run where kind = 'legal-base.load-start-catalog'",
    );
    expect(runs.rows.map((r) => r.status)).toEqual(["completed"]);
  });
});
