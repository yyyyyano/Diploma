// ADM-20, ADM-21, ADM-22, ADM-50, LLM-08, LLM-09, NFR-16, PRIV-02 на Postgres: админка ИИ — порядок цепочек, реестр
// моделей, «Проверить связь», ключи только для записи, цифры журнала расхода по прайсу. Провайдеры — подставные
// адаптеры (сети нет, NFR-11), секреты — в памяти.
import { APICallError } from "@ai-sdk/provider";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { SecretDef, SecretStatus } from "../../../platform/secrets/secrets.ts";
import type { ProviderAdapter } from "../infrastructure/providers/provider-adapter.ts";
import { createProviderRegistry } from "../infrastructure/providers/providers.ts";
import { RemoteStatusError } from "../infrastructure/providers/remote-fetch.ts";
import { GROQ_API_KEY } from "../settings.ts";
import { makeLlmAdmin } from "./admin.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const NOW = "2026-10-29T12:00:00Z";

function adapter(
  id: string,
  options: {
    cloud: boolean;
    models?: () => Promise<readonly string[]>;
    configured?: boolean;
    probe?: (modelId: string) => Promise<void>;
  },
): ProviderAdapter {
  return {
    id,
    cloud: options.cloud,
    languageModel: () => {
      throw new Error("не должна зваться: админка моделей не вызывает");
    },
    isConfigured: async () => options.configured ?? true,
    ...(options.models === undefined ? {} : { listModels: options.models }),
    ...(options.probe === undefined ? {} : { probe: options.probe }),
  };
}

type AdapterOptions = Parameters<typeof adapter>[1];

function setup(overrides: Partial<Record<"groq" | "zai" | "llama", AdapterOptions>> = {}) {
  const stored = new Map<string, string>();
  const secrets = {
    status: async (def: SecretDef): Promise<SecretStatus> =>
      stored.has(def.name) ? "set" : "unset",
    set: async (def: SecretDef, value: string) => void stored.set(def.name, value),
    clear: async (def: SecretDef) => void stored.delete(def.name),
    reveal: async (def: SecretDef) => stored.get(def.name),
  };
  const clock = new FakeClock(NOW);
  const admin = makeLlmAdmin({
    platform: { system: createSystemDb(db.pool), secrets, clock, log: memoryLogger().log },
    providers: createProviderRegistry([
      adapter("test", { cloud: false }),
      adapter("groq", overrides.groq ?? { cloud: true }),
      adapter("zai", overrides.zai ?? { cloud: true }),
      adapter("llama", overrides.llama ?? { cloud: false }),
    ]),
    langfuseUrl: "http://127.0.0.1:3001",
  });
  return { admin, stored, clock };
}

async function seedRegistry() {
  await db.owner.query("delete from llm_usage");
  await db.owner.query("delete from llm_task_chains");
  await db.owner.query("delete from llm_models where provider <> 'test'");
  await db.owner.query(
    `insert into llm_models (id, provider, model_id, cloud, capabilities, priority, context_tokens, rpd, tpd, input_micros_per_million, output_micros_per_million) values
     ('groq/big', 'groq', 'big', true, array['text','tools','structured'], 1, 8192, 1000, 200000, 590000, 790000),
     ('zai/flash', 'zai', 'flash', true, array['text','tools','structured'], 2, 8192, null, null, 0, 0),
     ('llama/local', 'llama', 'local', false, array['text','tools','structured','images'], 90, 8192, null, null, 0, 0),
     ('llama/bge', 'llama', 'bge', false, array['embeddings'], 50, 8192, null, null, 0, 0),
     ('groq/vision', 'groq', 'vision', true, array['images','structured'], 3, 8192, null, null, 0, 0)`,
  );
}
beforeEach(seedRegistry);

describe("ADM-50: «Провайдеры ИИ» — цепочки по задачам", () => {
  it("без настройки порядок задачи — по приоритету записей с нужными возможностями; ключи — статус, не значение", async () => {
    const { admin } = setup();
    const view = await admin.providers();
    expect(view.chains.find((chain) => chain.task === "chat")).toEqual({
      task: "chat",
      custom: false,
      models: ["groq/big", "zai/flash", "llama/local", "test/scripted"],
    });
    expect(view.chains.find((chain) => chain.task === "embed")?.models).toEqual([
      "llama/bge",
      "test/scripted",
    ]);
    expect(view.providers.find((provider) => provider.id === "groq")).toEqual({
      id: "groq",
      cloud: true,
      key: "unset",
    });
    expect(view.providers.find((provider) => provider.id === "llama")?.key).toBe("none");
  });

  it("порядок задачи сохраняется и виден как заданный администратором", async () => {
    const { admin } = setup();
    const view = await admin.setChain("chat", ["llama/local", "groq/big"]);
    expect(view.chains.find((chain) => chain.task === "chat")).toEqual({
      task: "chat",
      custom: true,
      models: ["llama/local", "groq/big"],
    });
    const again = await admin.setChain("chat", ["zai/flash"]);
    expect(again.chains.find((chain) => chain.task === "chat")?.models).toEqual(["zai/flash"]);
  });

  it.each([
    ["неизвестная модель", ["nobody/none"]],
    ["модель без нужной возможности (чеку нужны изображения)", ["groq/big"]],
    ["повтор модели", ["groq/vision", "groq/vision"]],
  ])("%s — VALIDATION, цепочка не меняется", async (_name, models) => {
    const { admin } = setup();
    await expect(admin.setChain("receipt.extract", models)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect((await db.owner.query("select 1 from llm_task_chains")).rowCount).toBe(0);
  });

  it("NFR-05: облачную модель в цепочку векторов поставить нельзя", async () => {
    await db.owner.query(
      "update llm_models set capabilities = array['embeddings'] where id = 'groq/vision'",
    );
    await expect(setup().admin.setChain("embed", ["groq/vision"])).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("включение и выключение модели; нет такой — NOT_FOUND", async () => {
    const { admin } = setup();
    const view = await admin.enable("groq/big", false);
    expect(view.models.find((model) => model.id === "groq/big")?.enabled).toBe(false);
    await expect(admin.enable("nobody/none", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("LLM-09: реестр моделей — добавить, возможности, цены, лимиты, разрешённые для выбора", () => {
  const input = {
    provider: "zai",
    model: "glm-next",
    capabilities: ["text", "tools"] as ("text" | "tools")[],
    priority: 30,
    userSelectable: true,
    contextTokens: 65_536,
    inputMicrosPerMillion: 100,
    outputMicrosPerMillion: 200,
    limits: { rpm: 10, tpm: null, rpd: 500, tpd: null },
  };

  it("новая модель существующего провайдера: облачность — по провайдеру; правка не трогает включённость", async () => {
    const { admin } = setup();
    const added = await admin.saveModel(input);
    expect(added.models.find((model) => model.id === "zai/glm-next")).toMatchObject({
      cloud: true,
      enabled: true,
      userSelectable: true,
      limits: { rpm: 10, rpd: 500 },
    });
    await admin.enable("zai/glm-next", false);
    const edited = await admin.saveModel({ ...input, priority: 5, userSelectable: false });
    expect(edited.models.find((model) => model.id === "zai/glm-next")).toMatchObject({
      enabled: false,
      priority: 5,
      userSelectable: false,
    });
  });

  it("PRIV-02: «локальная» запись у облачного провайдера невозможна, у локального — облачной", async () => {
    const { admin } = setup();
    const view = await admin.saveModel({ ...input, provider: "llama", model: "qwen-next" });
    expect(view.models.find((model) => model.id === "llama/qwen-next")?.cloud).toBe(false);
  });

  it("неизвестный провайдер и тестовый провайдер — VALIDATION", async () => {
    const { admin } = setup();
    await expect(admin.saveModel({ ...input, provider: "unknown" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(admin.saveModel({ ...input, provider: "test" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("LLM-08, ADM-50: «Проверить связь»", () => {
  it("провайдер отвечает и модель в списке — ok со временем", async () => {
    const { admin } = setup({ groq: { cloud: true, models: async () => ["big", "other"] } });
    expect(await admin.testConnection("groq/big")).toMatchObject({ ok: true });
  });

  it("модели нет в списке провайдера — model-missing", async () => {
    const { admin } = setup({ groq: { cloud: true, models: async () => ["other"] } });
    expect(await admin.testConnection("groq/big")).toEqual({ ok: false, reason: "model-missing" });
  });

  it("список провайдера неполон (Z.ai): модели в нём нет, но проба отвечает — связь есть", async () => {
    const { admin } = setup({
      zai: { cloud: true, models: async () => ["glm-4.5"], probe: async () => undefined },
    });
    expect(await admin.testConnection("zai/flash")).toMatchObject({ ok: true });
  });

  it("проба отвечает 400 — модели у провайдера нет; 429 «перегружен» — провайдер не отвечает", async () => {
    const failure = (statusCode: number) =>
      new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode });
    const missing = setup({
      zai: {
        cloud: true,
        models: async () => [],
        probe: async () => {
          throw failure(400);
        },
      },
    });
    expect(await missing.admin.testConnection("zai/flash")).toEqual({
      ok: false,
      reason: "model-missing",
    });
    const busy = setup({
      zai: {
        cloud: true,
        models: async () => [],
        probe: async () => {
          throw failure(429);
        },
      },
    });
    expect(await busy.admin.testConnection("zai/flash")).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("ключ не задан — no-key, до сети не доходит", async () => {
    let called = false;
    const { admin } = setup({
      groq: {
        cloud: true,
        configured: false,
        models: async () => {
          called = true;
          return [];
        },
      },
    });
    expect(await admin.testConnection("groq/big")).toEqual({ ok: false, reason: "no-key" });
    expect(called).toBe(false);
  });

  it("провайдер ответил 401 — unauthorized; сеть недоступна — unreachable", async () => {
    const denied = setup({
      groq: {
        cloud: true,
        models: async () => {
          throw new RemoteStatusError(401);
        },
      },
    });
    expect(await denied.admin.testConnection("groq/big")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    const down = setup({
      groq: {
        cloud: true,
        models: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    });
    expect(await down.admin.testConnection("groq/big")).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("провайдер без проверки списка — unsupported; нет такой записи — NOT_FOUND", async () => {
    const { admin } = setup();
    expect(await admin.testConnection("groq/big")).toEqual({ ok: false, reason: "unsupported" });
    await expect(admin.testConnection("nobody/none")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("NFR-16, ADM-50: ключи API — только запись", () => {
  const SECRET = "gsk_очень-секретное-значение-123";

  it("после сохранения статус «задан»; значения нет ни в одном ответе админки; снятие возвращает «не задан»", async () => {
    const { admin, stored } = setup();
    const view = await admin.setKey("groq", SECRET);
    expect(view.providers.find((provider) => provider.id === "groq")?.key).toBe("set");
    expect(stored.get(GROQ_API_KEY.name)).toBe(SECRET);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(await admin.usage("day"))).not.toContain(SECRET);
    const cleared = await admin.setKey("groq", null);
    expect(cleared.providers.find((provider) => provider.id === "groq")?.key).toBe("unset");
  });
});

describe("ADM-20, ADM-21, ADM-22: «Запросы к ИИ» — цифры журнала", () => {
  async function usage(
    task: string,
    provider: string,
    model: string,
    tokens: [number, number],
    ms: number,
    error: string | null,
    hoursAgo: number,
  ) {
    await db.owner.query(
      `insert into llm_usage (task, provider, model, input_tokens, output_tokens, ms, cost_micros, error_code, created_at)
       values ($1, $2, $3, $4, $5, $6, 0, $7, $8::timestamptz - make_interval(hours => $9))`,
      [task, provider, model, tokens[0], tokens[1], ms, error, NOW, hoursAgo],
    );
  }

  async function seedUsage() {
    await usage("chat", "groq", "big", [1000, 500], 200, null, 1);
    await usage("chat", "groq", "big", [2000, 1000], 400, null, 2);
    await usage("chat", "groq", "big", [0, 0], 100, "APICallError", 3);
    await usage("receipt.extract", "zai", "flash", [3000, 100], 600, null, 5);
    await usage("chat", "llama", "local", [500, 500], 9000, null, 30);
    await usage("chat", "groq", "big", [10_000, 10_000], 300, null, 24 * 10);
  }

  it("за сутки: запросы, токены, стоимость по прайсу, медиана, ошибки, по задачам и провайдерам, облако и локально", async () => {
    await seedUsage();
    const view = await setup().admin.usage("day");
    expect(view.totals).toEqual({
      requests: 4,
      tokens: 7600,
      // groq/big: 3000 вход × 0,59 + 1500 выход × 0,79 микродолларов за токен, вверх до целого
      costMicros: 2955,
      medianMs: 300,
      errors: 1,
      errorPermille: 250,
    });
    expect(view.byTask).toEqual([
      { task: "chat", requests: 3, tokens: 4500 },
      { task: "receipt.extract", requests: 1, tokens: 3100 },
    ]);
    expect(view.byProvider).toEqual([
      { provider: "groq", cloud: true, requests: 3, tokens: 4500, errors: 1 },
      { provider: "zai", cloud: true, requests: 1, tokens: 3100, errors: 0 },
    ]);
    expect(view.cloudRequests).toBe(4);
    expect(view.localRequests).toBe(0);
    expect(view.langfuseUrl).toBe("http://127.0.0.1:3001");
  });

  it("за 7 и 30 дней охват шире; локальные ответы считаются отдельно", async () => {
    await seedUsage();
    const { admin } = setup();
    const week = await admin.usage("week");
    expect(week.totals.requests).toBe(5);
    expect(week.localRequests).toBe(1);
    expect(week.cloudRequests).toBe(4);
    expect((await admin.usage("month")).totals.requests).toBe(6);
  });

  it("расход дневных лимитов — за скользящие сутки: использовано и лимит тарифа", async () => {
    await seedUsage();
    const view = await setup().admin.usage("day");
    expect(view.dailyLimits.find((row) => row.id === "groq/big")).toEqual({
      id: "groq/big",
      provider: "groq",
      requests: { used: 3, limit: 1000 },
      tokens: { used: 4500, limit: 200_000 },
    });
    // у Z.ai лимит не опубликован, но расход есть — строка показывается с limit: null
    expect(view.dailyLimits.find((row) => row.id === "zai/flash")).toMatchObject({
      requests: { used: 1, limit: null },
    });
  });

  it("ADM-21: правка прайса меняет условную стоимость за период; нет такой записи — NOT_FOUND", async () => {
    await seedUsage();
    const { admin } = setup();
    const view = await admin.setPrice("zai/flash", {
      inputMicrosPerMillion: 1_000_000,
      outputMicrosPerMillion: 0,
    });
    // к 2955 добавляются 3000 входных токенов Z.ai × 1 микродоллар
    expect(view.totals.costMicros).toBe(2955 + 3000);
    expect(view.prices.find((price) => price.id === "zai/flash")).toMatchObject({
      inputMicrosPerMillion: 1_000_000,
    });
    await expect(
      admin.setPrice("nobody/none", { inputMicrosPerMillion: 1, outputMicrosPerMillion: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("журнала нет — нули и пустые списки, медианы нет", async () => {
    const view = await setup().admin.usage("day");
    expect(view.totals).toEqual({
      requests: 0,
      tokens: 0,
      costMicros: 0,
      medianMs: null,
      errors: 0,
      errorPermille: 0,
    });
    expect(view.byTask).toEqual([]);
  });
});
