// LLM-02, LLM-08, NFR-16: адаптеры Groq, Z.ai и llama-server — какой адрес и заголовки уходят в сеть, как подставляется
// ключ, как проверяется связь. Сеть — подставной fetch: тесты офлайн (NFR-11).
import { generateText, Output } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../../../../platform/errors/app-error.ts";
import { createGroqAdapter } from "./groq.ts";
import { createLlamaAdapter, createZaiAdapter } from "./openai-compatible.ts";

interface Seen {
  url: string;
  authorization: string | null;
  body: Record<string, unknown> | undefined;
}

const urlOf = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** fetch, отвечающий как OpenAI-совместимый сервер; запросы складывает в seen. */
function fakeFetch(answer: string, seen: Seen[]): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : undefined;
    seen.push({
      url: urlOf(input),
      authorization: headers.get("authorization"),
      body: raw === undefined ? undefined : (JSON.parse(raw) as Record<string, unknown>),
    });
    if (urlOf(input).endsWith("/models")) {
      return Response.json({ data: [{ id: "model-a" }, { id: "model-b" }] });
    }
    return Response.json({
      id: "x",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [
        { index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
  };
}

describe("Groq", () => {
  it("запрос уходит на api.groq.com с ключом из секрета на момент вызова", async () => {
    const seen: Seen[] = [];
    let key: string | undefined = "gsk-first";
    const adapter = createGroqAdapter({ key: async () => key, fetch: fakeFetch("привет", seen) });
    const call = () =>
      generateText({ model: adapter.languageModel("openai/gpt-oss-120b"), prompt: "Привет" });
    expect((await call()).text).toBe("привет");
    key = "gsk-second";
    await call();
    expect(seen.map((s) => s.url)).toEqual([
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
    ]);
    expect(seen.map((s) => s.authorization)).toEqual(["Bearer gsk-first", "Bearer gsk-second"]);
    expect(seen[0]?.body?.["model"]).toBe("openai/gpt-oss-120b");
  });

  it("ключ не задан — до сети не доходит: UNAVAILABLE, провайдер «не настроен»", async () => {
    const seen: Seen[] = [];
    const adapter = createGroqAdapter({ key: async () => undefined, fetch: fakeFetch("x", seen) });
    expect(await adapter.isConfigured?.()).toBe(false);
    await expect(
      generateText({ model: adapter.languageModel("m"), prompt: "p", maxRetries: 0 }),
    ).rejects.toBeInstanceOf(AppError);
    expect(seen).toEqual([]);
  });

  it("«Проверить связь»: список моделей провайдера по GET /models", async () => {
    const seen: Seen[] = [];
    const adapter = createGroqAdapter({ key: async () => "gsk", fetch: fakeFetch("x", seen) });
    expect(await adapter.listModels?.()).toEqual(["model-a", "model-b"]);
    expect(seen[0]).toMatchObject({
      url: "https://api.groq.com/openai/v1/models",
      authorization: "Bearer gsk",
    });
  });
});

describe("Z.ai", () => {
  const Schema = z.object({ city: z.string() });

  it("схема ответа переносится в системное сообщение, режим — json_object (Z.ai не знает json_schema)", async () => {
    const seen: Seen[] = [];
    const adapter = createZaiAdapter({
      key: async () => "zai-key",
      fetch: fakeFetch('{"city":"Минск"}', seen),
    });
    const result = await generateText({
      model: adapter.languageModel("glm-4.7-flash"),
      prompt: "Столица?",
      output: Output.object({ schema: Schema }),
    });
    expect(result.output).toEqual({ city: "Минск" });
    expect(seen[0]?.url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(seen[0]?.authorization).toBe("Bearer zai-key");
    const body = seen[0]?.body as {
      response_format: unknown;
      messages: { role: string; content: string }[];
    };
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain('"city"');
  });
});

describe("Z.ai: неполный список моделей", () => {
  it("модель вне GET /models проверяется пробой на один токен", async () => {
    const seen: Seen[] = [];
    const adapter = createZaiAdapter({
      key: async () => "zai-key",
      fetch: fakeFetch("pong", seen),
    });
    await adapter.probe?.("glm-4.7-flash");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(seen[0]?.body).toMatchObject({ model: "glm-4.7-flash", max_tokens: 1 });
  });

  it("у Groq и llama-server пробы нет: их список моделей полон", () => {
    expect("probe" in createGroqAdapter({ key: async () => "k" })).toBe(false);
    expect("probe" in createLlamaAdapter({ baseUrl: async () => "http://127.0.0.1:8142/v1" })).toBe(
      false,
    );
  });
});

describe("llama-server", () => {
  it("адрес — настройка, читается на каждый вызов; ключа нет; схема уходит как json_schema", async () => {
    const seen: Seen[] = [];
    let base = "http://127.0.0.1:8142/v1";
    const adapter = createLlamaAdapter({
      baseUrl: async () => base,
      fetch: fakeFetch('{"city":"Минск"}', seen),
    });
    expect(await adapter.isConfigured?.()).toBe(true);
    const call = () =>
      generateText({
        model: adapter.languageModel("qwen3.5-4b"),
        prompt: "Столица?",
        output: Output.object({ schema: z.object({ city: z.string() }) }),
      });
    await call();
    base = "http://llama:8080/v1/";
    await call();
    expect(seen.map((s) => s.url)).toEqual([
      "http://127.0.0.1:8142/v1/chat/completions",
      "http://llama:8080/v1/chat/completions",
    ]);
    expect(seen[0]?.authorization).toBeNull();
    expect(seen[0]?.body?.["response_format"]).toMatchObject({ type: "json_schema" });
  });

  it("векторы — модель embeddings того же адаптера", () => {
    const adapter = createLlamaAdapter({ baseUrl: async () => "http://127.0.0.1:8142/v1" });
    expect(adapter.embeddingModel?.("bge-m3").modelId).toBe("bge-m3");
  });
});
