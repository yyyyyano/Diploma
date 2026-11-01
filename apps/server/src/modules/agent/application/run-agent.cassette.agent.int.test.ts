// Поведение живой модели вокруг агента на записанных кассетах (QA-17, NFR-11): запись — `make ai-record SCENARIO=agent/<имя>`
// (Groq через шлюз llm, синтетический пользователь с облачным согласием, ключи читает программа из .env), обычный прогон —
// повтор записи без сети. Проверяется итог для пользователя, а не слова модели: что записано в БД, что предложено и не
// выполнено, на каком языке ответ, ни одного числа вне результатов инструментов. Сценарии со скриптованной моделью — в
// `run-agent.agent.int.test.ts`. Дата сценариев зафиксирована (кассета ключуется последним сообщением, а в нём — сегодня).
import { makeScope, type Scope } from "@kosht/kernel";
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { cassetteFile, cassetteMode, FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import type { UIMessage } from "ai";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  composeOnTestDb,
  type TestComposition,
} from "../../../main/__fixtures__/compose-on-test-db.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { LegalConsultFacade } from "../../legal-consult/index.ts";
import type { LlmFacade } from "../../llm/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import { makeRunAgent } from "./run-agent.ts";

// Запись идёт живой моделью с паузами между шагами (pacedForRecording): обычные 30 с теста не хватит.
vi.setConfig({ testTimeout: 240_000 });

const TODAY = "2026-10-31";
const YESTERDAY = "2026-10-30";

const MIGRATIONS = join(import.meta.dirname, "../../../../drizzle");

/**
 * Запись идёт живой цепочкой Groq → Z.ai (шаблон тестов оставляет в реестре только тестовый провайдер): умолчания реестра
 * берутся из SQL миграций llm, тестовая модель выключается. Повтору кассеты реестр не нужен.
 */
async function useLiveRegistry(testDb: TestDb): Promise<void> {
  const dirs = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith("_llm-providers") || name.endsWith("_llm-statement-scan"))
    .toSorted();
  const statements = dirs
    .map((dir) => readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8"))
    .join("--> statement-breakpoint")
    .split("--> statement-breakpoint")
    .map((part) => part.replace(/^\s*(--[^\n]*\n)+/gm, "").trim())
    .filter((statement) => /^(INSERT|UPDATE)\b/.test(statement));
  await testDb.owner.query("delete from llm_models where provider <> 'test'");
  await testDb.owner.query("delete from llm_task_chains");
  await testDb.owner.query("update llm_models set enabled = true where id = 'test/scripted'");
  for (const statement of statements) await testDb.owner.query(statement);
  await testDb.owner.query("update llm_models set enabled = false where provider = 'test'");
}

let db: TestDb;
let household = 500;
const stands: TestComposition[] = [];

beforeAll(async () => {
  db = await createTestDb();
  if ((process.env["AI_RECORD"] ?? "") !== "") await useLiveRegistry(db);
});
afterAll(async () => {
  for (const stand of stands) await stand.close();
  await db.drop();
});

interface Stand {
  readonly scenario: string;
  /** Кассета, из которой идёт повтор: копия во временной папке (запись пишет в настоящий файл). */
  readonly cassette: string;
  readonly stand: TestComposition;
  readonly scope: Scope;
  readonly s: ScopedDb;
}

/** Композиция с кассетой сценария и пользователем с облачным согласием (нужно только записи: повтор шлюз не спрашивает). */
async function standFor(scenario: string): Promise<Stand> {
  const record = cassetteMode(scenario) === "record";
  const source = cassetteFile(import.meta.url, scenario);
  // Повтор идёт с копии: id операций из БД у каждого прогона свои, и сценарий их подменяет (rewriteIds), не трогая файл.
  const copy = join(await mkdtemp(join(tmpdir(), "kosht-cassette-")), "cassette.json");
  if (!record) await copyFile(source, copy).catch(() => undefined);
  const stand = await composeOnTestDb(db, "api", {
    LLM_MODE: record ? "record" : "replay",
    LLM_CASSETTE: record ? source : copy,
    LLM_CASSETTE_DELAYS: "0",
    ...(record
      ? {
          GROQ_API_KEY: process.env["GROQ_API_KEY"] ?? "",
          ZAI_API_KEY: process.env["ZAI_API_KEY"] ?? "",
        }
      : {}),
  });
  stands.push(stand);
  await stand.composition.startJobs();
  household += 1;
  const scope = makeScope(testScope({ user: household, household }));
  await db.owner.query(
    "insert into privacy_consents (household_id, user_id, kind, granted, text_version) values ($1, $2, 'cloud', true, $3)",
    [scope.householdId, scope.userId, CONSENT_VERSIONS.cloud],
  );
  return { stand, scope, s: stand.composition.platform.scoped(scope), cassette: copy, scenario };
}

const facade = <F>(stand: TestComposition, id: string): F => {
  const module = stand.composition.modules.find((m) => m.id === id);
  if (module === undefined) throw new Error(`нет модуля ${id}`);
  return module.facade as F;
};

/**
 * Повтор: id операций в записанных вызовах модели («delete_transaction» с id из поиска) заменяются настоящими id
 * этого прогона — по порядку. Запись (record) файл не трогает: в ней id настоящие.
 */
async function rewriteIds({ cassette, scenario }: Stand, actual: readonly string[]): Promise<void> {
  if (cassetteMode(scenario) === "record") return;
  const text = await readFile(cassette, "utf8");
  const file = JSON.parse(text) as { steps: { parts: { part: Record<string, unknown> }[] }[] };
  for (const step of file.steps) {
    for (const { part } of step.parts) {
      if (part["type"] !== "tool-call" || typeof part["input"] !== "string") continue;
      const input = JSON.parse(part["input"]) as { ids?: string[] };
      if (input.ids === undefined) continue;
      input.ids = input.ids.map((_, i) => actual[i] ?? "");
      part["input"] = JSON.stringify(input);
    }
  }
  await writeFile(cassette, JSON.stringify(file));
}

async function seedExpense(
  { stand, s }: Stand,
  day: string,
  minor: number,
  merchant: string,
): Promise<string> {
  const add = stand.composition.platform.tools().find((def) => def.name === "add_transaction");
  if (add === undefined || add.kind === "destructive") throw new Error("нет add_transaction");
  const result = (await add.execute(
    { s, requestId: "seed", channel: "web" },
    add.input.parse({ type: "expense", amountMinor: minor, date: day, merchant }),
  )) as { transaction: { id: string } };
  return result.transaction.id;
}

/**
 * Только запись: лимит Groq — 8 000 токенов в минуту, а префикс агента — около 3 000 на каждый шаг, поэтому третий шаг
 * подряд упирается в лимит и цепочка уходит на недоступные запасные модели. Между шагами — пауза: так окно лимита успевает
 * освободиться. Повтор кассеты пауз не знает.
 */
const RECORD_PACE_MS = 35_000;

function pacedForRecording(llm: LlmFacade): LlmFacade {
  return {
    ...llm,
    model: async (...args) => {
      const chat = await llm.model(...args);
      let calls = 0;
      const model = new Proxy(chat.model, {
        get(target, property, receiver) {
          if (property !== "doStream") return Reflect.get(target, property, receiver) as unknown;
          return async (options: Parameters<typeof target.doStream>[0]) => {
            if (calls > 0) await new Promise((resolve) => setTimeout(resolve, RECORD_PACE_MS));
            calls += 1;
            return target.doStream(options);
          };
        },
      });
      return { ...chat, model };
    },
  };
}

interface Answer {
  readonly message: UIMessage;
  readonly text: string;
  readonly log: Record<string, unknown>[];
}

async function ask(
  { stand, s, scenario }: Stand,
  question: string,
  history: readonly UIMessage[] = [],
): Promise<Answer> {
  const platform = stand.composition.platform;
  const memory = memoryLogger();
  let finished: UIMessage | undefined;
  const run = makeRunAgent({
    llm:
      cassetteMode(scenario) === "record"
        ? pacedForRecording(facade<LlmFacade>(stand, "llm"))
        : facade<LlmFacade>(stand, "llm"),
    actions: facade<ActionsFacade>(stand, "actions"),
    profile: facade<ProfileFacade>(stand, "profile"),
    legalConsult: facade<LegalConsultFacade>(stand, "legal-consult"),
    tools: () => platform.tools(),
    scoped: (scope) => platform.scoped(scope),
    log: memory.log,
    clock: new FakeClock(`${TODAY}T09:00:00Z`),
    maxSteps: async () => 8,
    historyMessages: async () => 12,
  });
  const stream = await run(s, {
    messages: [...history, { id: "q-1", role: "user", parts: [{ type: "text", text: question }] }],
    abortSignal: new AbortController().signal,
    requestId: "cassette-test",
    sessionId: "dialog-1",
    messageId: "m-1",
    metadata: { runId: "run-1" },
    onFinish: async (message) => {
      finished = message;
    },
  });
  for await (const chunk of stream) void chunk;
  if (finished === undefined) throw new Error("запуск не вызвал onFinish");
  // Нет кассеты или сбой модели агент превращает в вежливую пометку: тест не должен принять её за ответ.
  const failures = memory
    .lines()
    .map((line) => String(line["msg"]))
    .filter((msg) => ["agent.model-failed", "agent.run-failed"].includes(msg));
  if (failures.length > 0)
    throw new Error(`Запуск упал (${failures.join(", ")}): нет кассеты или модель недоступна.`);
  const text = finished.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  return { message: finished, text, log: memory.lines() };
}

const toolParts = (answer: Answer, name: string) =>
  answer.message.parts.filter((part) => part.type === `tool-${name}`) as {
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
  }[];

const count = async ({ scope }: Stand): Promise<number> => {
  const { rows } = await db.owner.query<{ n: number }>(
    "select count(*)::int as n from transactions where household_id = $1",
    [scope.householdId],
  );
  return rows[0]?.n ?? -1;
};

const unverifiedNote = (answer: Answer) =>
  answer.log.some((line) => line["msg"] === "agent.number-unverified");

describe("AGT-05: «Потратил 15 рублей на кофе» — запись и «Отменить»", () => {
  it("модель вызвала add_transaction на 15,00 BYN; операция записана в «Кафе», числа ответа проверены", async () => {
    const user = await standFor("agent/coffee");
    const answer = await ask(user, "Потратил 15 рублей на кофе");
    // Модель могла ошибиться во входе (лишнее поле) и поправить вызов: записанных операций — одна.
    const add = toolParts(answer, "add_transaction").filter(
      (part) => part.output?.["transaction"] !== undefined,
    );
    expect(add).toHaveLength(1);
    expect(add[0]?.output).toMatchObject({
      transaction: { amount: { minor: 1500, currency: "BYN" }, category: { code: "cafes" } },
      undoToken: expect.any(String),
    });
    expect(await count(user)).toBe(1);
    expect(unverifiedNote(answer)).toBe(false);
    // Название категории — словами из результата инструмента, без внутреннего кода.
    expect(answer.text).toContain("Кафе");
    expect(answer.text).not.toContain("cafes");
  });
});

describe("AGT-07: «Удали все траты за вчера» — ничего не удалено без «Да»", () => {
  it("модель нашла операции и предложила удаление; все операции на месте", async () => {
    const user = await standFor("agent/delete-yesterday");
    const first = await seedExpense(user, YESTERDAY, 1_000, "Такси");
    const second = await seedExpense(user, YESTERDAY, 2_000, "Кофейня");
    await seedExpense(user, TODAY, 500, "Хлеб");
    // Поиск отдаёт новые первыми: id второй операции идёт раньше (uuid v7 растут со временем).
    await rewriteIds(user, [second, first]);
    const answer = await ask(user, "Удали все траты за вчера");
    const proposals = toolParts(answer, "delete_transaction");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0]?.output).toMatchObject({ ok: true, pending: { count: 2 } });
    expect(await count(user)).toBe(3);
  });
});

describe("AGT-10: вопрос по-белорусски — ответ по-русски", () => {
  it("модель посчитала траты на такси за сентябрь инструментом и ответила по-русски", async () => {
    const user = await standFor("agent/belarusian");
    await seedExpense(user, "2026-09-12", 12_000, "Такси");
    const answer = await ask(user, "Колькі я патраціў на таксі ў верасні 2026 года?");
    expect(answer.text.length).toBeGreaterThan(0);
    // Белорусские буквы («ў», «і»): по-русски они не пишутся — ответ должен быть русским, а не на языке вопроса.
    expect(answer.text).not.toMatch(/[ўЎіІ]/u);
    expect(answer.text).toMatch(/[а-яё]/iu);
    expect(unverifiedNote(answer)).toBe(false);
  });
});

describe("AGT-08: «а в августе?» после сентября", () => {
  it("модель понимает, что вопрос о тех же тратах, и спрашивает данные за август", async () => {
    const user = await standFor("agent/august");
    await seedExpense(user, "2026-08-14", 8_000, "Такси");
    const history: UIMessage[] = [
      {
        id: "q-0",
        role: "user",
        parts: [{ type: "text", text: "Сколько я потратил на такси в сентябре?" }],
      },
      {
        id: "a-0",
        role: "assistant",
        parts: [{ type: "text", text: "В сентябре на такси вы ничего не тратили." }],
      },
    ];
    const answer = await ask(user, "а в августе?", history);
    const calls = [
      ...toolParts(answer, "aggregate_transactions"),
      ...toolParts(answer, "search_transactions"),
    ];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(
      calls.some((call) =>
        (typeof call.input["from"] === "string" ? call.input["from"] : "").startsWith("2026-08"),
      ),
    ).toBe(true);
    expect(unverifiedNote(answer)).toBe(false);
  });
});
