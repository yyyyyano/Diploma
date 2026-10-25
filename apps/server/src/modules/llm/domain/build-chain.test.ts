import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildChain, type ModelRecord } from "./build-chain.ts";
import { CAPABILITIES, TASKS, type LlmTask } from "./tasks.ts";

const record = (id: string, patch: Partial<ModelRecord> = {}): ModelRecord => ({
  id,
  provider: id.split("/")[0] ?? id,
  modelId: id.split("/")[1] ?? id,
  cloud: false,
  capabilities: ["text", "tools", "structured"],
  priority: 100,
  enabled: true,
  ...patch,
});

const groq = record("groq/llama", { cloud: true, priority: 10 });
const zai = record("zai/glm", { cloud: true, priority: 20 });
const local = record("llama/qwen", { priority: 90 });
const vision = record("llama/vision", { capabilities: ["images", "structured"], priority: 95 });
const embedder = record("llama/bge-m3", { capabilities: ["embeddings"], priority: 50 });
const cloudEmbedder = record("groq/embed", {
  capabilities: ["embeddings"],
  cloud: true,
  priority: 1,
});
const all = [local, vision, zai, groq, embedder, cloudEmbedder];

describe("LLM-02, LLM-09: цепочка по задаче из возможностей реестра", () => {
  it("с согласием — облачные по приоритету, затем локальные; без нужной возможности — не в цепочке", () => {
    expect(buildChain(all, "chat", { cloudAllowed: true }).map((m) => m.id)).toEqual([
      "groq/llama",
      "zai/glm",
      "llama/qwen",
    ]);
    expect(buildChain(all, "receipt.extract", { cloudAllowed: true }).map((m) => m.id)).toEqual([
      "llama/vision",
    ]);
  });

  it("PRIV-02: без облачного согласия — только локальные", () => {
    expect(buildChain(all, "chat", { cloudAllowed: false }).map((m) => m.id)).toEqual([
      "llama/qwen",
    ]);
  });

  it("NFR-05: эмбеддинги — только локально, даже с согласием", () => {
    expect(buildChain(all, "embed", { cloudAllowed: true }).map((m) => m.id)).toEqual([
      "llama/bge-m3",
    ]);
  });

  it("выключенная запись не участвует; выбранная пользователем — первой (LLM-10)", () => {
    const off = record("groq/off", { cloud: true, priority: 1, enabled: false });
    const chain = buildChain([...all, off], "chat", {
      cloudAllowed: true,
      preferred: "llama/qwen",
    });
    expect(chain.map((m) => m.id)).toEqual(["llama/qwen", "groq/llama", "zai/glm"]);
  });

  it("выбранная, но облачная без согласия — не попадает и первой не становится", () => {
    expect(
      buildChain(all, "chat", { cloudAllowed: false, preferred: "groq/llama" }).map((m) => m.id),
    ).toEqual(["llama/qwen"]);
  });

  it("свойство: при cloudAllowed = false в любой цепочке любой задачи только локальные записи", () => {
    const models = fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        provider: fc.constant("p"),
        modelId: fc.constant("m"),
        cloud: fc.boolean(),
        capabilities: fc.subarray([...CAPABILITIES]),
        priority: fc.integer({ min: 0, max: 100 }),
        enabled: fc.boolean(),
      }),
    );
    const task = fc.constantFrom(...(Object.keys(TASKS) as LlmTask[]));
    expect(() =>
      fc.assert(
        fc.property(models, task, fc.option(fc.string()), (list, t, preferred) => {
          const chain = buildChain(list, t, {
            cloudAllowed: false,
            ...(preferred === null ? {} : { preferred }),
          });
          return chain.every((m) => !m.cloud && m.enabled);
        }),
      ),
    ).not.toThrow();
  });
});
