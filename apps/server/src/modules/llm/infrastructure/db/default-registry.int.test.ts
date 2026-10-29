// LLM-02, LLM-09, PRIV-02: умолчания реестра, которые кладёт миграция T-023, — Groq → Z.ai → локальная по каждой задаче,
// тестовая модель выключена в боевой базе. Шаблонная база тестов (test-template.ts) эти строки сбрасывает, чтобы
// тесты шли на тестовом провайдере, поэтому здесь SQL умолчаний берётся из файла миграции и выполняется в свежей базе.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { buildChain } from "../../domain/build-chain.ts";
import { TASKS, type LlmTask } from "../../domain/tasks.ts";
import { listChains, listModels } from "./llm.repo.ts";

const MIGRATIONS = join(import.meta.dirname, "../../../../../drizzle");

/** SQL «руками» миграции llm-providers: всё после создания таблиц (вставки и выключение тестовой модели). */
function seedStatements(): string[] {
  const dir = readdirSync(MIGRATIONS).find((name) => name.endsWith("_llm-providers"));
  if (dir === undefined) throw new Error("нет миграции llm-providers");
  const sql = readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((part) => part.replace(/^\s*(--[^\n]*\n)+/gm, "").trim())
    .filter((statement) => /^(INSERT|UPDATE)\b/.test(statement));
}

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  // Шаблон тестов уже сброшен фикстурой: возвращаем состояние «сразу после миграции».
  await db.owner.query("delete from llm_models where provider <> 'test'");
  await db.owner.query("delete from llm_task_chains");
  await db.owner.query("update llm_models set enabled = true where id = 'test/scripted'");
  for (const statement of seedStatements()) await db.owner.query(statement);
});
afterAll(async () => {
  await db.drop();
});

const providersOf = async (task: LlmTask, cloudAllowed: boolean) => {
  const system = createSystemDb(db.pool);
  const chains = await listChains(system);
  const order = chains.get(task);
  return buildChain(await listModels(system), task, {
    cloudAllowed,
    ...(order === undefined ? {} : { order }),
  }).map((model) => model.provider);
};

describe("LLM-02: цепочка по умолчанию — Groq, затем Z.ai, затем локальная", () => {
  it.each([
    "chat",
    "receipt.extract",
    "statement.columns",
    "classify.category",
    "classify.off-topic",
    "law.topic",
  ] as const)("задача %s: Groq → Z.ai → локальная", async (task) => {
    expect(await providersOf(task, true)).toEqual(["groq", "zai", "llama"]);
  });

  it("голос — облачный Whisper Groq, векторы — только локальная модель (NFR-05)", async () => {
    expect(await providersOf("transcribe", true)).toEqual(["groq"]);
    expect(await providersOf("embed", true)).toEqual(["llama"]);
  });

  it("PRIV-02: без облачного согласия в каждой цепочке только локальные модели", async () => {
    for (const task of Object.keys(TASKS) as LlmTask[]) {
      const providers = await providersOf(task, false);
      expect(providers.filter((provider) => provider !== "llama")).toEqual([]);
    }
  });

  it("у каждой задачи из TASKS есть строки цепочки", async () => {
    const chains = await listChains(createSystemDb(db.pool));
    expect([...chains.keys()].toSorted()).toEqual(Object.keys(TASKS).toSorted());
  });
});

describe("тестовая модель в боевой базе", () => {
  it("выключена миграцией: чат отвечает настоящими моделями", async () => {
    const models = await listModels(createSystemDb(db.pool));
    expect(models.find((model) => model.id === "test/scripted")?.enabled).toBe(false);
  });

  it("лимиты бесплатного тарифа Groq записаны в реестр (LLM-09)", async () => {
    const models = await listModels(createSystemDb(db.pool));
    expect(models.find((model) => model.id === "groq/openai/gpt-oss-120b")?.limits).toEqual({
      rpm: 30,
      tpm: 8000,
      rpd: 1000,
      tpd: 200000,
    });
  });
});
