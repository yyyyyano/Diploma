// LLM-02, LLM-03, LLM-05, LLM-10, PRIV-02, ADM-50 на настоящем Postgres: порядок цепочки по задачам из llm_task_chains,
// лимитёр по журналу расхода (восстановление после перезапуска), выбор модели пользователем и «Модель X недоступна,
// ответила Y», провайдер без ключа, уведомления администратору. Модели — MockLanguageModelV4 (NFR-11).
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { FakeClock, MockLanguageModelV4, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { createTelemetry } from "../../../platform/telemetry/telemetry.ts";
import type { ProviderAdapter } from "../infrastructure/providers/provider-adapter.ts";
import { createProviderRegistry } from "../infrastructure/providers/providers.ts";
import type { ChainEvent } from "./chained-model.ts";
import { createLlmGateway } from "./gateway.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const scope = testScope();
const NOW = "2026-10-29T09:00:00Z";
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function answering(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

function broken() {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("провайдер недоступен");
    },
  });
}

/** Адаптер провайдера: каждая модель отвечает своим текстом (id модели) или ломается. */
function adapter(
  id: string,
  models: Record<string, LanguageModelV4>,
  configured = true,
): ProviderAdapter {
  return {
    id,
    languageModel: (modelId) => models[modelId] ?? answering(`${id}/${modelId}`),
    isConfigured: async () => configured,
  };
}

async function addModel(
  id: string,
  patch: {
    cloud?: boolean;
    priority?: number;
    limits?: [number | null, number | null];
    selectable?: boolean;
  } = {},
) {
  const [provider, ...rest] = id.split("/");
  await db.owner.query(
    `insert into llm_models (id, provider, model_id, cloud, capabilities, priority, context_tokens, rpm, rpd, user_selectable)
     values ($1, $2, $3, $4, array['text','tools','structured'], $5, 8192, $6, $7, $8)`,
    [
      id,
      provider,
      rest.join("/"),
      patch.cloud ?? true,
      patch.priority ?? 100,
      patch.limits?.[0] ?? null,
      patch.limits?.[1] ?? null,
      patch.selectable ?? false,
    ],
  );
}

async function setChain(task: string, ids: string[]) {
  await db.owner.query("delete from llm_task_chains where task = $1", [task]);
  for (const [index, id] of ids.entries()) {
    await db.owner.query(
      "insert into llm_task_chains (task, model_id, position) values ($1, $2, $3)",
      [task, id, index + 1],
    );
  }
}

beforeEach(async () => {
  await db.owner.query("delete from llm_usage");
  await db.owner.query("delete from llm_task_chains");
  await db.owner.query("delete from llm_models where provider <> 'test'");
  await db.owner.query("update llm_models set enabled = false where provider = 'test'");
});

function gateway(
  adapters: ProviderAdapter[],
  options: {
    consent?: boolean;
    preferred?: string;
    events?: ChainEvent[];
    clock?: FakeClock;
  } = {},
) {
  const clock = options.clock ?? new FakeClock(NOW);
  const memory = memoryLogger();
  return {
    clock,
    llm: createLlmGateway({
      system: createSystemDb(db.pool),
      providers: createProviderRegistry(adapters),
      consent: { cloudAllowed: async () => options.consent ?? true },
      telemetry: createTelemetry(),
      clock,
      log: memory.log,
      cassettes: async () => ({ mode: "live" }),
      timeouts: async () => ({ cloudMs: 5000, localMs: 5000 }),
      ...(options.preferred === undefined ? {} : { preferredModel: async () => options.preferred }),
      onProviderEvent: async (event) => {
        options.events?.push(event);
      },
    }),
  };
}

async function ask(llm: ReturnType<typeof gateway>["llm"], who = scope) {
  const { model } = await llm.model(who, "chat");
  const result = await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Привет" }] }],
  });
  const answer = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return { answer, metadata: result.providerMetadata?.["kosht"] };
}

describe("ADM-50: порядок цепочки по задаче", () => {
  it("настройка задачи важнее приоритета записей", async () => {
    await addModel("groq/a", { priority: 1 });
    await addModel("zai/b", { priority: 2 });
    await setChain("chat", ["zai/b", "groq/a"]);
    const { llm } = gateway([adapter("groq", {}), adapter("zai", {})]);
    expect((await ask(llm)).answer).toBe("zai/b");
  });

  it("у задачи без строк порядок — по приоритету", async () => {
    await addModel("groq/a", { priority: 2 });
    await addModel("zai/b", { priority: 1 });
    const { llm } = gateway([adapter("groq", {}), adapter("zai", {})]);
    expect((await ask(llm)).answer).toBe("zai/b");
  });

  it("провайдер без ключа не в цепочке и ошибкой не считается: отвечает следующий", async () => {
    await addModel("groq/a", { priority: 1 });
    await addModel("zai/b", { priority: 2 });
    const events: ChainEvent[] = [];
    const { llm } = gateway([adapter("groq", {}, false), adapter("zai", {})], { events });
    const { answer, metadata } = await ask(llm);
    expect(answer).toBe("zai/b");
    expect(metadata).toEqual({ model: "zai/b", unavailable: [] });
    expect(events).toEqual([]);
  });
});

describe("LLM-03: отказ провайдера и уведомление администратору", () => {
  it("первый сломался — отвечает второй, журнал помнит обе попытки, администратору — событие «ошибка»", async () => {
    await addModel("groq/a", { priority: 1 });
    await addModel("zai/b", { priority: 2 });
    const events: ChainEvent[] = [];
    const { llm } = gateway([adapter("groq", { a: broken() }), adapter("zai", {})], { events });
    const { answer, metadata } = await ask(llm);
    expect(answer).toBe("zai/b");
    expect(metadata).toEqual({ model: "zai/b", unavailable: ["groq/a"] });
    expect(events).toEqual([{ kind: "error", provider: "groq", model: "groq/a" }]);
    const { rows } = await db.owner.query<{ provider: string; error_code: string | null }>(
      "select provider, error_code from llm_usage order by created_at, id",
    );
    expect(rows).toEqual([
      { provider: "groq", error_code: "Error" },
      { provider: "zai", error_code: null },
    ]);
  });
});

describe("LLM-05: лимиты тарифа восстанавливаются из журнала расхода", () => {
  it("rpm = 2, в журнале уже два запроса за последнюю минуту — модель пропущена до окончания окна", async () => {
    await addModel("groq/a", { priority: 1, limits: [2, null] });
    await addModel("zai/b", { priority: 2 });
    const first = answering("groq/a");
    const { llm, clock } = gateway([adapter("groq", { a: first }), adapter("zai", {})]);
    for (const seconds of [10, 5]) {
      await db.owner.query(
        `insert into llm_usage (task, provider, model, input_tokens, output_tokens, ms, cost_micros, created_at)
         values ('chat', 'groq', 'a', 10, 5, 100, 0, $1::timestamptz - make_interval(secs => $2))`,
        [NOW, seconds],
      );
    }
    expect((await ask(llm)).answer).toBe("zai/b");
    expect(first.doGenerateCalls).toHaveLength(0);
    // Минута прошла — строки вышли из окна, модель снова в работе (перезапуска процесса лимитёр не боится).
    clock.advance(61_000);
    expect((await ask(llm)).answer).toBe("groq/a");
  });

  it("исчерпан суточный лимит запросов — администратору «лимит», пользователь ответ получает", async () => {
    await addModel("groq/a", { priority: 1, limits: [null, 1] });
    await addModel("zai/b", { priority: 2 });
    await db.owner.query(
      `insert into llm_usage (task, provider, model, input_tokens, output_tokens, ms, cost_micros, created_at)
       values ('chat', 'groq', 'a', 10, 5, 100, 0, $1::timestamptz - interval '3 hours')`,
      [NOW],
    );
    const events: ChainEvent[] = [];
    const { llm } = gateway([adapter("groq", {}), adapter("zai", {})], { events });
    expect((await ask(llm)).answer).toBe("zai/b");
    expect(events).toEqual([{ kind: "limit", provider: "groq", model: "groq/a" }]);
  });
});

describe("LLM-10, PRIV-02: выбор модели пользователем", () => {
  it("выбранная разрешённая модель отвечает первой; недоступна — «Модель X недоступна, ответила Y»", async () => {
    await addModel("groq/a", { priority: 1 });
    await addModel("zai/b", { priority: 2, selectable: true });
    const ok = gateway([adapter("groq", {}), adapter("zai", {})], { preferred: "zai/b" });
    expect((await ask(ok.llm)).answer).toBe("zai/b");
    const down = gateway([adapter("groq", {}), adapter("zai", { b: broken() })], {
      preferred: "zai/b",
    });
    const { answer, metadata } = await ask(down.llm);
    expect(answer).toBe("groq/a");
    expect(metadata).toEqual({ model: "groq/a", unavailable: ["zai/b"] });
  });

  it("модель, которую администратор не разрешил выбирать, выбором не становится", async () => {
    await addModel("groq/a", { priority: 1 });
    await addModel("zai/b", { priority: 2, selectable: false });
    const { llm } = gateway([adapter("groq", {}), adapter("zai", {})], { preferred: "zai/b" });
    expect((await ask(llm)).answer).toBe("groq/a");
  });

  it("PRIV-02, инвариант: выбранная облачная модель после отзыва согласия не используется", async () => {
    await addModel("zai/b", { priority: 2, selectable: true });
    await addModel("llama/local", { priority: 90, cloud: false });
    const { llm } = gateway([adapter("zai", {}), adapter("llama", {})], {
      preferred: "zai/b",
      consent: false,
    });
    expect((await ask(llm)).answer).toBe("llama/local");
    const rows = await db.owner.query("select provider from llm_usage");
    expect(rows.rows).toEqual([{ provider: "llama" }]);
  });

  it("выбор действует только в чате: задача извлечения идёт по порядку цепочки", async () => {
    await addModel("groq/a", { priority: 1 });
    await addModel("zai/b", { priority: 2, selectable: true });
    const { llm } = gateway([adapter("groq", {}), adapter("zai", {})], { preferred: "zai/b" });
    const { model } = await llm.model(scope, "chat");
    expect(model.modelId).toBeDefined();
    const label = await llm
      .classify(scope, {
        task: "classify.category",
        labels: ["a"],
        instructions: "x",
        text: "y",
        promptVersion: "v1",
      })
      .catch(() => "none");
    // Первой в цепочке классификации — groq (ответ — не JSON, поэтому ошибка схемы), а не выбранная zai.
    expect(label).toBe("none");
    const { rows } = await db.owner.query<{ provider: string }>(
      "select provider from llm_usage where task = 'classify.category' order by created_at limit 1",
    );
    expect(rows[0]?.provider).toBe("groq");
  });
});
