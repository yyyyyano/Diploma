// LLM-01, LLM-06, LLM-09, PRIV-02, PRIV-09, NFR-05, NFR-11: шлюз на настоящем Postgres — цепочка из реестра моделей
// по возможностям и согласию, журнал расхода без текстов, запрет вызова в транзакции, кассеты replay/record.
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { Scope } from "@kosht/kernel";
import { FakeClock, MockLanguageModelV4, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { isStepCount, streamText, tool, type ToolSet } from "ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { createTelemetry } from "../../../platform/telemetry/telemetry.ts";
import { systemCaller } from "../domain/caller.ts";
import { CassetteError } from "../infrastructure/providers/cassettes.ts";
import type { ProviderAdapter } from "../infrastructure/providers/provider-adapter.ts";
import { createProviderRegistry } from "../infrastructure/providers/providers.ts";
import {
  ACCOUNTS_ANSWER,
  createTestProvider,
  EMBEDDING_DIMENSIONS,
  TRANSCRIPT,
} from "../infrastructure/providers/test-provider.ts";
import { LlmInTransactionError, LlmSchemaError } from "./errors.ts";
import { createLlmGateway, type CassetteConfig } from "./gateway.ts";

let db: TestDb;
const dir = mkdtempSync(join(tmpdir(), "kosht-llm-"));
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.owner.query("delete from llm_usage");
  await db.owner.query("delete from llm_models where provider <> 'test'");
});

const scope = testScope();

/** Облачная модель «cloud/mock» — MockLanguageModelV4 с заданным ответом. */
function cloudProvider(model: LanguageModelV4): ProviderAdapter {
  return { id: "cloud", languageModel: () => model };
}

async function addCloudModel(priority = 1) {
  await db.owner.query(
    `insert into llm_models (id, provider, model_id, cloud, capabilities, priority, context_tokens,
       input_micros_per_million, output_micros_per_million)
     values ('cloud/mock', 'cloud', 'mock', true, array['text','tools','structured'], $1, 8192, 1000000, 2000000)`,
    [priority],
  );
}

function textModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function gateway(
  options: {
    cloud?: LanguageModelV4;
    consent?: (scope: Scope) => Promise<boolean>;
    cassettes?: CassetteConfig;
  } = {},
) {
  const adapters = [createTestProvider()];
  if (options.cloud !== undefined) adapters.push(cloudProvider(options.cloud));
  const memory = memoryLogger();
  return {
    memory,
    llm: createLlmGateway({
      system: createSystemDb(db.pool),
      providers: createProviderRegistry(adapters),
      consent: { cloudAllowed: options.consent ?? (async () => false) },
      telemetry: createTelemetry(false),
      clock: new FakeClock("2026-10-25T09:00:00Z"),
      log: memory.log,
      cassettes: async () => options.cassettes ?? { mode: "live" },
    }),
  };
}

const accountsTool = {
  list_accounts: tool({
    description: "List accounts.",
    inputSchema: z.object({}),
    execute: async () => ({ items: [] }),
  }),
} satisfies ToolSet;

async function usageRows() {
  return (
    await db.owner.query<Record<string, unknown>>(
      "select task, provider, model, input_tokens, output_tokens, cost_micros, error_code from llm_usage order by created_at, id",
    )
  ).rows;
}

describe("LLM-09, PRIV-02: цепочка из реестра", () => {
  it("без облачного согласия — тестовая локальная модель, даже если облачная первая по приоритету", async () => {
    await addCloudModel();
    const { llm } = gateway({ cloud: textModel("облако") });
    const { model } = await llm.model(scope, "chat");
    expect(model.provider).toBe("test");
  });

  it("с согласием — облачная модель первой", async () => {
    await addCloudModel();
    const { llm } = gateway({ cloud: textModel("облако"), consent: async () => true });
    expect((await llm.model(scope, "chat")).model.provider).toBe("cloud");
  });

  it("PRIV-09: systemCaller — облако разрешено без согласия пользователя", async () => {
    await addCloudModel();
    const { llm } = gateway({ cloud: textModel("облако") });
    expect((await llm.model(systemCaller("legal-base"), "chat")).model.provider).toBe("cloud");
  });

  it("нет подходящей модели — UNAVAILABLE", async () => {
    await db.owner.query("update llm_models set enabled = false");
    try {
      await expect(gateway().llm.model(scope, "chat")).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
    } finally {
      await db.owner.query("update llm_models set enabled = true");
    }
  });

  it("облачная упала до ответа — отвечает следующая в цепочке (LLM-03)", async () => {
    await addCloudModel();
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("503");
      },
    });
    const { llm } = gateway({ cloud: broken, consent: async () => true });
    const { model } = await llm.model(scope, "chat");
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Привет" }] }],
    });
    expect(result.content).toEqual([
      { type: "text", text: "Я тестовая модель Кошта и отвечаю по сценарию." },
    ]);
  });
});

describe("LLM-01: агентский поток на тестовом провайдере", () => {
  it("пользователь спросил — вызов list_accounts, затем по результату — текст ответа сценария", async () => {
    const { llm } = gateway();
    const { model } = await llm.model(scope, "chat");
    const result = streamText({
      model,
      tools: accountsTool,
      prompt: "Какие у меня счета?",
      stopWhen: isStepCount(2),
    });
    const steps = await result.steps;
    expect(steps.map((step) => step.toolCalls.map((call) => call.toolName))).toEqual([
      ["list_accounts"],
      [],
    ]);
    expect(await result.text).toBe(ACCOUNTS_ANSWER);
  });
});

describe("LLM-06: журнал расхода", () => {
  it("строка на каждый вызов: задача, провайдер, модель, токены, стоимость — без текстов, email и сумм", async () => {
    const { llm } = gateway();
    const { model } = await llm.model(scope, "chat");
    const secret = "Ivan.Petrov@mail.by, карта 4111 1111 1111 1111, сумма 1 234,56 BYN";
    await streamText({ model, prompt: secret }).consumeStream();
    const rows = await usageRows();
    expect(rows).toEqual([
      {
        task: "chat",
        provider: "test",
        model: "scripted",
        input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
        cost_micros: "0",
        error_code: null,
      },
    ]);
    const text = JSON.stringify(
      (await db.owner.query("select * from llm_usage")).rows,
    ).toLowerCase();
    for (const leak of ["ivan", "4111", "1 234,56", "сумма"]) expect(text).not.toContain(leak);
  });

  it("стоимость облачного вызова — по ценам записи реестра", async () => {
    await addCloudModel();
    const { llm } = gateway({ cloud: textModel("ответ"), consent: async () => true });
    const { model } = await llm.model(scope, "chat");
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "x" }] }] });
    expect(await usageRows()).toMatchObject([
      { provider: "cloud", input_tokens: 10, output_tokens: 5, cost_micros: "20" },
    ]);
  });
});

describe("ARCHITECTURE §4.3: модель внутри s.transaction — LLM_IN_TRANSACTION", () => {
  it("model() и вызов уже полученной модели в транзакции — ошибка, вне — работает", async () => {
    const { llm } = gateway();
    const s = createScopedDb(db.pool, scope);
    const { model } = await llm.model(scope, "chat");
    await expect(s.transaction(() => llm.model(scope, "chat"))).rejects.toBeInstanceOf(
      LlmInTransactionError,
    );
    await expect(
      s.transaction(async () =>
        model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
      ),
    ).rejects.toMatchObject({ code: "LLM_IN_TRANSACTION" });
    await expect(
      model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
    ).resolves.toBeDefined();
  });
});

describe("LLM-04: извлечение и классификация по схеме", () => {
  const schema = z.object({ total: z.int() });

  it("ответ по схеме — объект; документ уходит блоком <document>", async () => {
    await addCloudModel();
    let prompt = "";
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        prompt = JSON.stringify(options.prompt);
        return {
          content: [{ type: "text", text: '{"total":842}' }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const { llm } = gateway({ cloud: model, consent: async () => true });
    const result = await llm.extract(scope, {
      task: "statement.columns",
      schema,
      instructions: "Верни итог.",
      document: "Итого 8,42",
      promptVersion: "1",
    });
    expect(result).toEqual({ total: 842 });
    expect(prompt).toContain("<document>\\nИтого 8,42\\n</document>");
  });

  it("не по схеме дважды — LlmSchemaError; со второй попытки — объект", async () => {
    await addCloudModel();
    const answers = ['{"total":"много"}', '{"total":"всё ещё"}'];
    const bad = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: answers.shift() ?? "{}" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const { llm } = gateway({ cloud: bad, consent: async () => true });
    const request = {
      task: "statement.columns",
      schema,
      instructions: "x",
      document: "y",
      promptVersion: "1",
    } as const;
    await expect(llm.extract(scope, request)).rejects.toBeInstanceOf(LlmSchemaError);
    answers.push('{"total":"нет"}', '{"total":5}');
    await expect(llm.extract(scope, request)).resolves.toEqual({ total: 5 });
  });

  it("классификация — метка из списка", async () => {
    await addCloudModel();
    const { llm } = gateway({ cloud: textModel('{"label":"taxi"}'), consent: async () => true });
    expect(
      await llm.classify(scope, {
        task: "classify.category",
        labels: ["food", "taxi"],
        instructions: "x",
        text: "Яндекс Go",
        promptVersion: "1",
      }),
    ).toBe("taxi");
  });
});

describe("NFR-05: векторы и речь", () => {
  it("эмбеддинги — локально (тестовый провайдер), строка журнала", async () => {
    const { llm } = gateway();
    const vectors = await llm.embed(scope, ["ст. 210 НК", "вычет"]);
    expect(vectors.map((v) => v.length)).toEqual([EMBEDDING_DIMENSIONS, EMBEDDING_DIMENSIONS]);
    expect(vectors[0]).toEqual((await llm.embed(scope, ["ст. 210 НК"]))[0]);
    expect((await usageRows()).map((r) => r["task"])).toEqual(["embed", "embed"]);
  });

  it("расшифровка речи — текст", async () => {
    expect(await gateway().llm.transcribe(scope, new Uint8Array([82, 73, 70, 70]))).toBe(
      TRANSCRIPT,
    );
  });
});

describe("NFR-11, QA-17: кассеты", () => {
  const ref = (name: string) => ({ scenario: `llm/${name}`, file: join(dir, `${name}.json`) });

  it("record пишет шаги, replay отдаёт тот же ответ без модели", async () => {
    const recorded = gateway({ cassettes: { mode: "record", cassette: ref("roundtrip") } }).llm;
    const live = await recorded.model(scope, "chat");
    const first = await streamText({ model: live.model, prompt: "Привет", tools: accountsTool })
      .text;
    const replayed = gateway({
      cassettes: { mode: "replay", cassette: ref("roundtrip"), delays: false },
    }).llm;
    const replay = await replayed.model(scope, "chat");
    expect(replay.model.provider).toBe("cassette");
    expect(
      await streamText({ model: replay.model, prompt: "Привет", tools: accountsTool }).text,
    ).toBe(first);
  });

  it("промах кассеты — ошибка с подсказкой make ai-record, а не поход в сеть", async () => {
    const { llm } = gateway({
      cassettes: { mode: "replay", cassette: ref("missing"), delays: false },
    });
    const { model } = await llm.model(scope, "chat");
    await expect(
      model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
    ).rejects.toThrow(/make ai-record SCENARIO=llm\/missing/);
  });

  it("другой запрос, чем в записи, — «запись устарела»", async () => {
    const recorded = gateway({ cassettes: { mode: "record", cassette: ref("stale") } }).llm;
    await streamText({
      model: (await recorded.model(scope, "chat")).model,
      prompt: "Привет",
    }).consumeStream();
    const { llm } = gateway({
      cassettes: { mode: "replay", cassette: ref("stale"), delays: false },
    });
    const { model } = await llm.model(scope, "chat");
    await expect(
      model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "Пока" }] }] }),
    ).rejects.toThrow(CassetteError);
  });
});

describe("OBS-03: трассы", () => {
  it("опции вызова — functionId задачи, внутренний userId и id диалога", async () => {
    const { telemetry } = await gateway().llm.model(scope, "chat", { sessionId: "dialog-1" });
    expect(telemetry).toEqual({
      telemetry: {
        isEnabled: false,
        functionId: "chat",
        includeRuntimeContext: { userId: true, sessionId: true },
      },
      runtimeContext: { userId: scope.userId, sessionId: "dialog-1" },
    });
  });
});
